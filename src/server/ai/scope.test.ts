import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../vault/vault.js';
import { resolvePaths } from '../config.js';
import { makeScope, type Scope } from '../context.js';
import { systemPrompt, taskIndex } from './context.js';
import { executeWrite, summarize } from './chat.js';
import { toolSchemas } from './schema.js';
import { ProposalStore } from './proposals.js';
import type { ProposedChange } from '@shared/types.js';

/**
 * The workspace promise: a chat in one workspace cannot read, search or change anything in
 * another. These tests work the same way the plugin does — build a scope, then try to reach
 * out of it through every door the model is given.
 */

let dir: string;
let vault: Vault;
let personal: Scope;
let work: Scope;
const NOW = new Date('2026-08-21T12:00:00');

const write = async (rel: string, body: string) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), body, 'utf8');
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scope-'));
  await write(
    'personal/board.md',
    '---\nname: "Personal"\nlanes:\n  - id: todo\n    name: To Do\n---\n',
  );
  await write(
    'personal/tasks/salary.md',
    '---\nid: salary\ntitle: Salary review notes\nstatus: todo\n---\n\nAsk for the raise in March.\n',
  );
  await write(
    'work/board.md',
    '---\nname: "Work"\nlanes:\n  - id: doing\n    name: Doing\n---\n',
  );
  await write(
    'work/tasks/release.md',
    '---\nid: release\ntitle: Ship the release\nstatus: doing\n---\n\nCut the branch on Friday.\n',
  );

  vault = new Vault(resolvePaths({ PLANNER_VAULT: dir, PLANNER_HOME: path.join(dir, '.app') }));
  await vault.load();
  personal = makeScope(vault, 'personal');
  work = makeScope(vault, 'work');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('what the model is shown', () => {
  it('names the workspace it is in', () => {
    expect(systemPrompt(work.store.list(NOW), work.store.lanes(), work.name, NOW)).toContain(
      'the "Work" workspace',
    );
  });

  it('lists only that workspace\'s tasks', () => {
    const prompt = systemPrompt(work.store.list(NOW), work.store.lanes(), work.name, NOW);
    expect(prompt).toContain('Ship the release');
    expect(prompt).not.toContain('Salary review notes');
  });

  it('tells it plainly that the rest of the vault is not visible', () => {
    const prompt = systemPrompt(work.store.list(NOW), work.store.lanes(), work.name, NOW);
    expect(prompt).toMatch(/cannot see them/i);
  });

  it('offers only that workspace\'s lanes as values it may set', () => {
    const schema = JSON.stringify(toolSchemas(work.store.lanes()));
    expect(schema).toContain('Doing');
    expect(schema).not.toContain('To Do');
  });

  it('shows no trace of the other workspace in the task index', () => {
    expect(taskIndex(personal.store.list(NOW), personal.store.lanes())).not.toContain('release');
  });
});

describe('what the model can reach', () => {
  it('cannot list across workspaces', () => {
    expect(work.tools.listTasks({}).map((t) => t.fields.id)).toEqual(['release']);
    expect(personal.tools.listTasks({}).map((t) => t.fields.id)).toEqual(['salary']);
  });

  it('cannot search across workspaces, by any word in the other file', () => {
    expect(work.tools.searchTasks({ query: 'salary' })).toEqual([]);
    expect(work.tools.searchTasks({ query: 'raise' })).toEqual([]);
    expect(work.tools.searchTasks({ query: 'March' })).toEqual([]);
  });

  it('cannot get another workspace\'s task, by title or by id', () => {
    expect(() => work.tools.getTask({ task: 'salary' })).toThrow(/no single task/i);
    expect(() => work.tools.getTask({ task: 'Salary review notes' })).toThrow(/no single task/i);
  });

  it('cannot write to another workspace through a write tool', async () => {
    await expect(
      executeWrite(work.tools, 'add_log', { task: 'salary', text: 'seen it' }, false),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeWrite(work.tools, 'archive_task', { task: 'salary' }, true),
    ).rejects.toMatchObject({ code: 'not_found' });

    const untouched = await fs.readFile(path.join(dir, 'personal/tasks/salary.md'), 'utf8');
    expect(untouched).not.toContain('seen it');
  });

  it('creates a task in its own folder, never another workspace\'s', async () => {
    const created = await executeWrite(work.tools, 'create_task', { title: 'New thing' }, true);
    expect(created.task.path).toBe('work/tasks/new-thing.md');
    expect(personal.store.list().map((t) => t.fields.id)).toEqual(['salary']);
  });
});

describe('approving a change the model drafted', () => {
  it('applies it in the workspace it was drafted in', async () => {
    const proposals = new ProposalStore((id) => makeScope(vault, id));
    const args = { task: 'release', text: 'branch cut' };
    const dry = await executeWrite(work.tools, 'add_log', args, false);
    const proposal: ProposedChange = {
      id: 'p1',
      tool: 'add_log',
      args,
      diff: dry.diff,
      summary: summarize('add_log', args, dry),
      state: 'pending',
    };
    proposals.add(proposal, work.id);

    const applied = await proposals.apply('p1');

    expect(applied.ok).toBe(true);
    expect(await fs.readFile(path.join(dir, 'work/tasks/release.md'), 'utf8')).toContain(
      'branch cut',
    );
  });
});

/**
 * The prompt has one job beyond describing the workspace: making a small model reach for
 * a tool instead of answering from the index. It used to say the tasks listed "are all of
 * it", which reads as "you already have the data" — and a 4B model believed it.
 */
describe('the prompt tells the model what it cannot see', () => {
  it('calls the list an index and says what it leaves out', () => {
    const prompt = systemPrompt(personal.store.list(NOW), personal.store.lanes(), 'Personal', NOW);
    expect(prompt).toMatch(/INDEX/);
    expect(prompt).toMatch(/does NOT hold descriptions, comments/i);
    // The old wording claimed the index was the whole of the data.
    expect(prompt).not.toMatch(/tasks below are all of it/i);
  });

  it('names the tool to call for each kind of question', () => {
    const prompt = systemPrompt(personal.store.list(NOW), personal.store.lanes(), 'Personal', NOW);
    expect(prompt).toContain('get_task');
    expect(prompt).toContain('search_tasks');
    expect(prompt).toMatch(/USE A TOOL WHEN/);
  });
});

describe('the index hands over what it has already worked out', () => {
  it('includes the attention reasons rather than leaving the model to do date maths', () => {
    const overdue = {
      fields: { id: 'x', title: 'Late thing', status: 'todo', due: '2026-08-01' },
      description: '',
      log: [],
      archived: false,
      path: 'tasks/x.md',
      derived: {
        momentum: 'stalled' as const,
        hoursSinceUpdate: 400,
        overdue: true,
        attentionReasons: ['Overdue by 20 days', 'No update for 16 days'],
      },
    };
    const index = taskIndex([overdue], [{ id: 'todo', name: 'To Do' }]);
    expect(index).toContain('Overdue by 20 days');
    expect(index).toContain('No update for 16 days');
  });

  it('says so when it is not showing every open task', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      fields: { id: 't' + i, title: 'Task ' + i, status: 'todo' },
      description: '',
      log: [],
      archived: false,
      path: 'tasks/t.md',
      derived: {
        momentum: 'slowing' as const,
        hoursSinceUpdate: i,
        overdue: false,
        attentionReasons: [],
      },
    }));
    const index = taskIndex(many, [{ id: 'todo', name: 'To Do' }]);
    expect(index).toMatch(/more open tasks are not listed/);
    expect(index).toContain('search_tasks');
  });

  it('stays quiet about truncation when there is none', () => {
    const index = taskIndex(personal.store.list(NOW), personal.store.lanes());
    expect(index).not.toMatch(/not listed/);
  });
});
