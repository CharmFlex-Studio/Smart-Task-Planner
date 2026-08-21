import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VaultStore } from '../vault/store.js';
import { PlannerTools } from './index.js';
import { ToolError } from './errors.js';
import { workspacePaths } from '../vault/workspaces.js';

let dir: string;
let store: VaultStore;
let tools: PlannerTools;
const NOW = new Date('2026-08-20T12:00:00');


beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-'));
  const paths = workspacePaths(dir, 'main');
  await fs.mkdir(paths.tasks, { recursive: true });
  await fs.mkdir(paths.archive, { recursive: true });
  await fs.writeFile(
    path.join(paths.tasks, 'pay.md'),
    '---\nid: pay1\ntitle: Payment integration\nstatus: in-progress\nupdated: 2026-08-18T09:00:00\n---\n\nWhy this matters.\n\n## Log\n\n- 2026-08-18 09:00 · progress · started\n',
    'utf8',
  );
  store = new VaultStore(paths, 'main');
  await store.load();
  tools = new PlannerTools(store, () => NOW);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const read = () => fs.readFile(path.join(dir, 'main/tasks/pay.md'), 'utf8');

describe('every write is a dry run first', () => {
  it('addLog with apply:false changes nothing on disk but returns a diff', async () => {
    const before = await read();
    const r = await tools.addLog({ task: 'pay1', type: 'blocker', text: 'no merchant logs' }, false);
    expect(r.applied).toBe(false);
    expect(await read()).toBe(before);
    expect(r.diff.patch).toContain('+- 2026-08-20 12:00 · blocker · no merchant logs');
    expect(r.task.log.at(-1)!.text).toBe('no merchant logs');
  });

  it('addLog with apply:true writes and bumps updated', async () => {
    const r = await tools.addLog({ task: 'pay1', type: 'progress', text: 'chased them' }, true);
    expect(r.applied).toBe(true);
    const raw = await read();
    expect(raw).toContain('- 2026-08-20 12:00 · progress · chased them');
    expect(raw).toContain('updated: 2026-08-20T12:00');
    expect(store.get('pay1')!.log).toHaveLength(2);
  });

  it('the dry-run diff matches what applying actually produces', async () => {
    const dry = await tools.setField({ task: 'pay1', field: 'status', value: 'review' }, false);
    const wet = await tools.setField({ task: 'pay1', field: 'status', value: 'review' }, true);
    expect(wet.diff.patch).toBe(dry.diff.patch);
  });
});

describe('setField', () => {
  it('changes one field and leaves the rest of the file alone', async () => {
    await tools.setField({ task: 'pay1', field: 'due', value: '2026-09-01' }, true);
    const raw = await read();
    expect(raw).toContain('due: 2026-09-01');
    expect(raw).toContain('- 2026-08-18 09:00 · progress · started');
    expect(raw).toContain('title: Payment integration');
  });

  it('clears a field when given an empty value', async () => {
    await tools.setField({ task: 'pay1', field: 'due', value: '2026-09-01' }, true);
    await tools.setField({ task: 'pay1', field: 'due', value: '' }, true);
    expect(await read()).not.toContain('due:');
  });

  it('rewrites the description in the body, not the frontmatter', async () => {
    const r = await tools.setField(
      { task: 'pay1', field: 'description', value: 'Merchant keeps timing out.' },
      true,
    );
    expect(r.task.description).toBe('Merchant keeps timing out.');
    const raw = await read();
    expect(raw).toContain('Merchant keeps timing out.');
    expect(raw).not.toContain('description:');
    expect(raw).not.toContain('Why this matters.');
    expect(raw).toContain('- 2026-08-18 09:00 · progress · started');
  });

  it('moves a task between lanes by lane name as well as by id', async () => {
    const r = await tools.setField({ task: 'pay1', field: 'status', value: 'In Review' }, true);
    expect(r.task.fields.status).toBe('review');
  });

  it('accepts tags as a comma-separated string', async () => {
    const r = await tools.setField({ task: 'pay1', field: 'tags', value: 'money, urgent' }, true);
    expect(r.task.fields.tags).toEqual(['money', 'urgent']);
  });

  it('rejects an unknown field', async () => {
    await expect(tools.setField({ task: 'pay1', field: 'colour' as never, value: 'red' }, true))
      .rejects.toBeInstanceOf(ToolError);
  });

  it('rejects a lane that is not on the board', async () => {
    await expect(tools.setField({ task: 'pay1', field: 'status', value: 'nowhere' }, true))
      .rejects.toMatchObject({ code: 'invalid' });
  });

  it('rejects a due date that is not YYYY-MM-DD', async () => {
    await expect(tools.setField({ task: 'pay1', field: 'due', value: 'next tuesday' }, true))
      .rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('createTask', () => {
  it('previews the whole file without creating it', async () => {
    const r = await tools.createTask({ title: 'New thing' }, false);
    expect(r.diff.created).toBe(true);
    expect(r.diff.patch).toContain('+title: New thing');
    await expect(fs.access(path.join(dir, 'main/tasks/new-thing.md'))).rejects.toThrow();
  });

  it('creates a real file with a generated id', async () => {
    const r = await tools.createTask({ title: 'New thing', description: 'why it matters' }, true);
    expect(r.applied).toBe(true);
    expect(r.task.fields.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(r.task.fields.status).toBe('todo');
    expect(r.task.path).toBe('main/tasks/new-thing.md');
    expect(r.task.description).toBe('why it matters');
    expect(store.get(r.task.fields.id)).toBeDefined();
  });

  it('rejects a blank title', async () => {
    await expect(tools.createTask({ title: '  ' }, true)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('archiveTask', () => {
  it('moves the file and puts it in the done lane', async () => {
    const r = await tools.archiveTask({ task: 'pay1' }, true);
    expect(r.task.archived).toBe(true);
    expect(r.task.fields.status).toBe('done');
    expect(r.task.derived.momentum).toBe('done');
    expect(r.task.path).toBe('main/archive/pay.md');
    await expect(fs.access(path.join(dir, 'main/tasks/pay.md'))).rejects.toThrow();
  });
});

describe('resolving a task reference', () => {
  it('accepts a title fragment, which is how the model will refer to things', async () => {
    const r = await tools.addLog({ task: 'payment', type: 'note', text: 'x' }, false);
    expect(r.task.fields.id).toBe('pay1');
  });

  it('refuses an ambiguous reference with a helpful hint', async () => {
    await fs.writeFile(path.join(dir, 'main/tasks/pay2.md'), '---\nid: pay2\ntitle: Payment retries\n---\n', 'utf8');
    await store.load();
    await expect(tools.addLog({ task: 'payment', type: 'note', text: 'x' }, false))
      .rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('read tools', () => {
  it('filters by lane', async () => {
    await tools.setField({ task: 'pay1', field: 'status', value: 'review' }, true);
    expect(tools.listTasks({ status: 'review' })).toHaveLength(1);
    expect(tools.listTasks({ status: 'todo' })).toHaveLength(0);
  });
  it('hides archived tasks unless asked', async () => {
    await tools.archiveTask({ task: 'pay1' }, true);
    expect(tools.listTasks({})).toHaveLength(0);
    expect(tools.listTasks({ includeArchived: true })).toHaveLength(1);
  });
  it('searches', () => {
    expect(tools.searchTasks({ query: 'payment' })).toHaveLength(1);
  });
});
