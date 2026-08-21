import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { buildApp } from './app.js';
import { resolvePaths } from './config.js';
import type { PlannerContext } from './context.js';
import type { Task, WriteResult } from '@shared/types.js';

let dir: string;
let paths: ReturnType<typeof resolvePaths>;
let app: Hono;
let ctx: PlannerContext;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
  paths = resolvePaths({ WATSMYTASK_VAULT: dir, WATSMYTASK_HOME: path.join(dir, '.app') });
  const built = await buildApp(paths);
  app = built.app;
  ctx = built.ctx;
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const get = (url: string) => app.request(`http://localhost${url}`);
const send = (url: string, method: string, body?: unknown) =>
  app.request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('health and settings', () => {
  it('reports the vault it is using', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tasks: 0 });
  });

  it('creates the vault layout on first run: one workspace, shaped like every other', async () => {
    expect((await fs.stat(path.join(dir, 'main/tasks'))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(dir, 'main/archive'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(dir, 'main/board.md'), 'utf8')).toContain('name: "Main"');
    // Nothing is left at the top of the vault but the workspace folders and the metadata.
    await expect(fs.access(path.join(dir, 'tasks'))).rejects.toThrow();
  });

  it('reports its version, so a stale install is tellable from a missing feature', async () => {
    const pkg = JSON.parse(
      await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    const health = await (await get('/api/health')).json();
    expect(health.version).toBe(pkg.version);

    const settings = await (await get('/api/settings')).json();
    expect(settings.version).toBe(pkg.version);
  });

  it('persists a settings change to disk', async () => {
    const res = await send('/api/settings', 'PATCH', { keepLoaded: true });
    expect(res.status).toBe(200);
    const saved = JSON.parse(await fs.readFile(paths.settingsFile, 'utf8'));
    expect(saved.keepLoaded).toBe(true);
  });

  it('ignores an implausible idle timeout instead of accepting it', async () => {
    await send('/api/settings', 'PATCH', { idleTimeoutMs: 5 });
    expect(ctx.settings.idleTimeoutMs).toBe(300_000);
  });

  it('refuses to auto-apply model writes by default', () => {
    expect(ctx.settings.autoApplyWrites).toBe(false);
  });
});

describe('task lifecycle over http', () => {
  it('creates, logs, moves and archives a task', async () => {
    const created = (await (await send('/api/tasks', 'POST', {
      title: 'Payment integration',
      description: 'The merchant webhook keeps timing out.',
    })).json()) as WriteResult;
    expect(created.applied).toBe(true);
    const id = created.task.fields.id;

    await send(`/api/tasks/${id}/log`, 'POST', { text: 'opened a ticket' });
    await send(`/api/tasks/${id}`, 'PATCH', { field: 'status', value: 'in-progress' });
    await send(`/api/tasks/${id}/log`, 'POST', { text: 'no logs from them yet' });

    const task = ((await (await get(`/api/tasks/${id}`)).json()) as { task: Task }).task;
    expect(task.fields.status).toBe('in-progress');
    expect(task.description).toBe('The merchant webhook keeps timing out.');
    expect(task.log).toHaveLength(2);
    expect(task.derived.momentum).toBe('moving');

    const archived = (await (await send(`/api/tasks/${id}/archive`, 'POST')).json()) as WriteResult;
    expect(archived.task.archived).toBe(true);
    expect(((await (await get('/api/tasks')).json()) as { tasks: Task[] }).tasks).toHaveLength(0);
  });

  it('the file on disk is readable markdown a human would recognise', async () => {
    const created = (await (await send('/api/tasks', 'POST', { title: 'Write the docs' })).json()) as WriteResult;
    await send(`/api/tasks/${created.task.fields.id}/log`, 'POST', {
      type: 'decision',
      text: 'markdown, not a database',
    });
    const raw = await fs.readFile(path.join(dir, 'main/tasks/write-the-docs.md'), 'utf8');
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain('title: Write the docs');
    expect(raw).toContain('## Log');
    expect(raw).toMatch(/- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · decision · markdown, not a database/);
  });

  it('dryRun returns a diff and writes nothing', async () => {
    const created = (await (await send('/api/tasks', 'POST', { title: 'Dry run me' })).json()) as WriteResult;
    const before = await fs.readFile(path.join(dir, 'main/tasks/dry-run-me.md'), 'utf8');

    const res = await send(`/api/tasks/${created.task.fields.id}/log?dryRun=1`, 'POST', {
      text: 'should not be saved',
    });
    const result = (await res.json()) as WriteResult;
    expect(result.applied).toBe(false);
    expect(result.diff.patch).toContain('should not be saved');
    expect(await fs.readFile(path.join(dir, 'main/tasks/dry-run-me.md'), 'utf8')).toBe(before);
  });

  it('reports a validation failure as 400 with a usable message', async () => {
    const created = (await (await send('/api/tasks', 'POST', { title: 'X' })).json()) as WriteResult;
    const res = await send(`/api/tasks/${created.task.fields.id}`, 'PATCH', {
      field: 'status',
      value: 'no-such-lane',
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ code: 'invalid' });
  });

  it('reports an unknown task as 404', async () => {
    expect((await get('/api/tasks/does-not-exist')).status).toBe(404);
  });

  it('reports an edit that raced an external change as 409', async () => {
    const created = (await (await send('/api/tasks', 'POST', { title: 'Raced' })).json()) as WriteResult;
    await fs.writeFile(path.join(dir, 'main/tasks/raced.md'), '---\nid: raced\ntitle: Changed elsewhere\n---\n');
    const res = await send(`/api/tasks/${created.task.fields.id}/log`, 'POST', { text: 'hi' });
    expect(res.status).toBe(409);
  });
});

describe('the board and its lanes', () => {
  it('starts with the default lanes, written into the vault as a file', async () => {
    const { board } = (await (await get('/api/board')).json()) as { board: { lanes: { id: string }[] } };
    expect(board.lanes.map((lane) => lane.id)).toEqual(['todo', 'in-progress', 'review', 'done']);
    expect((await fs.readFile(path.join(dir, 'main/board.md'), 'utf8'))).toContain('lanes:');
  });

  it('adds, renames and reorders lanes', async () => {
    await send('/api/board/lanes', 'POST', { name: 'Blocked' });
    await send('/api/board/lanes/blocked', 'PATCH', { name: 'Waiting' });
    // The id is the identity: renaming a lane leaves it, so no task file has to move.
    const res = await send('/api/board/lanes/order', 'POST', {
      ids: ['blocked', 'todo', 'in-progress', 'review', 'done'],
    });
    const { board } = (await res.json()) as { board: { lanes: { id: string; name: string }[] } };
    expect(board.lanes[0]).toEqual({ id: 'blocked', name: 'Waiting' });
  });

  it('takes the tasks with it when a lane is deleted', async () => {
    const created = (await (await send('/api/tasks', 'POST', {
      title: 'In review',
      status: 'review',
    })).json()) as WriteResult;

    const res = await send('/api/board/lanes/review?moveTo=todo', 'DELETE');
    expect((await res.json()) as { moved: number }).toMatchObject({ moved: 1 });

    const { task } = (await (await get(`/api/tasks/${created.task.fields.id}`)).json()) as { task: Task };
    expect(task.fields.status).toBe('todo');
  });

  it('reports a lane that does not exist as 404', async () => {
    expect((await send('/api/board/lanes/nope', 'PATCH', { name: 'X' })).status).toBe(404);
  });

  it('shows a lane a hand-written file invented rather than losing the task', async () => {
    await fs.writeFile(
      path.join(dir, 'main/tasks/odd.md'),
      '---\nid: odd\ntitle: Odd one\nstatus: someday\n---\n',
    );
    await send('/api/reload', 'POST');
    const { board } = (await (await get('/api/board')).json()) as { board: { lanes: { id: string }[] } };
    expect(board.lanes.map((lane) => lane.id)).toContain('someday');
  });
});

describe('workspaces over http', () => {
  const list = async () =>
    ((await (await get('/api/workspaces')).json()) as { workspaces: { id: string; name: string; taskCount: number }[] })
      .workspaces;

  it('starts with one workspace, in a folder like any other', async () => {
    expect(await list()).toEqual([{ id: 'main', name: 'Main', taskCount: 0 }]);
  });

  it('renames the workspace the vault started with — it is not a special case', async () => {
    const res = await send('/api/workspaces/main', 'PATCH', { name: 'Personal' });

    expect(res.status).toBe(200);
    expect(await list()).toEqual([{ id: 'main', name: 'Personal', taskCount: 0 }]);
    // The folder is the identity, so the rename is one line of one file.
    expect(await fs.readFile(path.join(dir, 'main/board.md'), 'utf8')).toContain('name: "Personal"');
    expect((await fs.stat(path.join(dir, 'main'))).isDirectory()).toBe(true);
  });

  it('creates one as a folder with its own board', async () => {
    const res = await send('/api/workspaces', 'POST', { name: 'Client Work' });
    expect(res.status).toBe(201);
    expect((await res.json()) as { workspace: unknown }).toMatchObject({
      workspace: { id: 'client-work', name: 'Client Work' },
    });
    expect((await fs.stat(path.join(dir, 'client-work/tasks'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(dir, 'client-work/board.md'), 'utf8')).toContain('lanes:');
  });

  it('keeps each workspace\'s tasks to itself', async () => {
    await send('/api/workspaces', 'POST', { name: 'Work' });
    await send('/api/tasks', 'POST', { title: 'Personal errand' });
    await send('/api/tasks?ws=work', 'POST', { title: 'Ship the release' });

    const here = (await (await get('/api/tasks')).json()) as { tasks: Task[] };
    const there = (await (await get('/api/tasks?ws=work')).json()) as { tasks: Task[] };

    expect(here.tasks.map((t) => t.fields.title)).toEqual(['Personal errand']);
    expect(there.tasks.map((t) => t.fields.title)).toEqual(['Ship the release']);
    expect((await fs.readdir(path.join(dir, 'work/tasks'))).length).toBe(1);
    expect((await fs.readdir(path.join(dir, 'main/tasks'))).length).toBe(1);
  });

  it('does not find another workspace\'s task, by search or by id', async () => {
    await send('/api/workspaces', 'POST', { name: 'Work' });
    const mine = (await (await send('/api/tasks', 'POST', { title: 'Salary review' })).json()) as WriteResult;

    const found = (await (await get('/api/search?q=salary&ws=work')).json()) as { matches: unknown[] };
    expect(found.matches).toEqual([]);
    expect((await get(`/api/tasks/${mine.task.fields.id}?ws=work`)).status).toBe(404);
    expect((await get(`/api/tasks/${mine.task.fields.id}`)).status).toBe(200);
  });

  it('gives each workspace its own board', async () => {
    await send('/api/workspaces', 'POST', { name: 'Work' });
    await send('/api/board/lanes?ws=work', 'POST', { name: 'Blocked' });

    const here = (await (await get('/api/board')).json()) as { board: { lanes: { id: string }[] } };
    const there = (await (await get('/api/board?ws=work')).json()) as { board: { lanes: { id: string }[] } };

    expect(here.board.lanes.map((l) => l.id)).not.toContain('blocked');
    expect(there.board.lanes.map((l) => l.id)).toContain('blocked');
  });

  it('renames without moving the folder or touching a task', async () => {
    await send('/api/workspaces', 'POST', { name: 'Work' });
    const created = (await (await send('/api/tasks?ws=work', 'POST', { title: 'Ship it' })).json()) as WriteResult;
    const before = await fs.readFile(path.join(dir, created.task.path), 'utf8');

    const res = await send('/api/workspaces/work', 'PATCH', { name: 'Client work' });

    expect(res.status).toBe(200);
    expect((await list()).map((w) => w.name)).toContain('Client work');
    expect(await fs.readFile(path.join(dir, created.task.path), 'utf8')).toBe(before);
  });

  it('refuses to delete a workspace that still holds tasks', async () => {
    await send('/api/workspaces', 'POST', { name: 'Work' });
    await send('/api/tasks?ws=work', 'POST', { title: 'Ship it' });

    const res = await send('/api/workspaces/work', 'DELETE');

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ code: 'invalid' });
    expect((await fs.stat(path.join(dir, 'work/tasks'))).isDirectory()).toBe(true);
  });

  it('deletes an empty one', async () => {
    await send('/api/workspaces', 'POST', { name: 'Work' });
    expect((await send('/api/workspaces/work', 'DELETE')).status).toBe(200);
    expect(await list()).toHaveLength(1);
    await expect(fs.access(path.join(dir, 'work'))).rejects.toThrow();
  });

  it('refuses to delete the last workspace, whichever one it is', async () => {
    const res = await send('/api/workspaces/main', 'DELETE');

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ code: 'invalid' });
    expect((await fs.stat(path.join(dir, 'main'))).isDirectory()).toBe(true);
  });

  it('reports a workspace it does not have as 404 rather than showing another', async () => {
    expect((await get('/api/tasks?ws=nope')).status).toBe(404);
    expect((await get('/api/board?ws=nope')).status).toBe(404);
    expect((await send('/api/tasks?ws=nope', 'POST', { title: 'x' })).status).toBe(404);
  });

  it('picks up a workspace folder created outside the app', async () => {
    await fs.mkdir(path.join(dir, 'reading/tasks'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'reading/tasks/book.md'),
      '---\nid: book\ntitle: Finish the book\n---\n',
    );
    await send('/api/reload', 'POST');

    expect((await list()).map((w) => w.id)).toEqual(['main', 'reading']);
    const there = (await (await get('/api/tasks?ws=reading')).json()) as { tasks: Task[] };
    expect(there.tasks.map((t) => t.fields.title)).toEqual(['Finish the book']);
  });
});

describe('history', () => {
  it('says the vault is not a repository instead of showing an empty list', async () => {
    const body = (await (await get('/api/history')).json()) as { repo: boolean; commits: unknown[] };
    expect(body.repo).toBe(false);
    expect(body.commits).toEqual([]);
  });

  it('starts a repository on request and commits what is already there', async () => {
    const res = await send('/api/history/init', 'POST');
    if (!(await ctx.git.gitInstalled())) return; // no git on this machine: nothing to assert
    expect(res.status).toBe(200);

    const body = (await (await get('/api/history')).json()) as {
      repo: boolean;
      commits: { subject: string }[];
    };
    expect(body.repo).toBe(true);
    expect(body.commits[0]!.subject).toBe('planner: start tracking this vault');
  });

  it('refuses to start one while history is switched off', async () => {
    await send('/api/settings', 'PATCH', { gitUndo: false });
    expect((await send('/api/history/init', 'POST')).status).toBe(400);
  });
});

describe('a vault laid out before workspaces existed', () => {
  let old: string;

  beforeEach(async () => {
    old = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-app-'));
    await fs.mkdir(path.join(old, 'tasks'), { recursive: true });
    await fs.mkdir(path.join(old, 'archive'), { recursive: true });
    await fs.writeFile(
      path.join(old, 'tasks/thing.md'),
      '---\nid: thing\ntitle: An older task\nstatus: in-progress\n---\n\n## Log\n\n- 2026-08-01 09:00 · note · from before\n',
    );
    await fs.writeFile(
      path.join(old, 'board.md'),
      '---\nname: "Personal notes"\nlanes:\n  - id: in-progress\n    name: Doing\n---\n',
    );
  });
  afterEach(() => fs.rm(old, { recursive: true, force: true }));

  it('moves it into a workspace folder, keeping its name, tasks and lanes', async () => {
    const built = await buildApp(
      resolvePaths({ WATSMYTASK_VAULT: old, WATSMYTASK_HOME: path.join(old, '.app') }),
    );
    const call = (url: string) => built.app.request(`http://localhost${url}`);

    const { workspaces } = (await (await call('/api/workspaces')).json()) as {
      workspaces: { id: string; name: string }[];
    };
    expect(workspaces).toEqual([{ id: 'personal-notes', name: 'Personal notes', taskCount: 1 }]);

    const { tasks } = (await (await call('/api/tasks')).json()) as { tasks: Task[] };
    expect(tasks.map((t) => t.fields.title)).toEqual(['An older task']);
    expect(tasks[0]!.path).toBe('personal-notes/tasks/thing.md');
    expect(tasks[0]!.log).toHaveLength(1);

    const { board } = (await (await call('/api/board')).json()) as { board: { lanes: { name: string }[] } };
    expect(board.lanes.map((l) => l.name)).toEqual(['Doing']);

    // The files moved; nothing was rewritten and nothing is left at the top of the vault.
    await expect(fs.access(path.join(old, 'tasks'))).rejects.toThrow();
    expect(await fs.readFile(path.join(old, 'personal-notes/tasks/thing.md'), 'utf8')).toContain(
      '· note · from before',
    );
  });

  it('does it once, and leaves the vault alone on every start after', async () => {
    const paths = resolvePaths({ WATSMYTASK_VAULT: old, WATSMYTASK_HOME: path.join(old, '.app') });
    await buildApp(paths);
    const after = await fs.readdir(old);
    await buildApp(paths);

    expect((await fs.readdir(old)).sort()).toEqual(after.sort());
  });
});

describe('picking up edits made outside the app', () => {
  it('sees a task written straight into the folder after a reload', async () => {
    await fs.writeFile(
      path.join(dir, 'main/tasks/hand-written.md'),
      '---\nid: hw\ntitle: Written in Obsidian\n---\n\n## Log\n\n- 2026-08-20 09:00 · note · typed by hand\n',
    );
    await send('/api/reload', 'POST');
    const { tasks } = (await (await get('/api/tasks')).json()) as { tasks: Task[] };
    expect(tasks.map((t) => t.fields.title)).toContain('Written in Obsidian');
  });
});

describe('today view', () => {
  it('separates what needs attention from what to continue', async () => {
    await fs.writeFile(
      path.join(dir, 'main/tasks/stale.md'),
      '---\nid: stale\ntitle: Forgotten thing\nstatus: in-progress\n---\n\n## Log\n\n- 2020-01-01 09:00 · progress · long ago\n',
    );
    await send('/api/tasks', 'POST', { title: 'Fresh thing' });
    await send('/api/reload', 'POST');

    const today = (await (await get('/api/today')).json()) as {
      needsAttention: Task[];
      continueWith: Task[];
    };
    expect(today.needsAttention.map((t) => t.fields.title)).toContain('Forgotten thing');
    expect(today.needsAttention[0]!.derived.attentionReasons[0]).toMatch(/no update/i);
    expect(today.continueWith.map((t) => t.fields.title)).toContain('Fresh thing');
  });
});

describe('ai routes without a model installed', () => {
  it('reports not_installed rather than pretending', async () => {
    const { status } = (await (await get('/api/ai/status')).json()) as { status: { state: string } };
    expect(status.state).toBe('not_installed');
  });

  it('lists nothing as available and offers starting points instead of a baked-in catalog', async () => {
    const view = (await (await get('/api/ai/models')).json()) as {
      available: unknown[];
      suggested: { repo: string }[];
      external: boolean;
    };
    // Nothing is downloaded in a fresh vault, and the list is read from disk rather than
    // from a hardcoded catalog, so it must be empty rather than optimistic.
    expect(view.available).toEqual([]);
    expect(view.external).toBe(false);
    expect(view.suggested.length).toBeGreaterThan(0);
    expect(view.suggested.every((s) => /^[\w.-]+\/[\w.-]+$/.test(s.repo))).toBe(true);
  });

  it('rejects a malformed repo id before it reaches the network', async () => {
    const res = await get('/api/ai/models/files?repo=../../etc/passwd');
    expect(res.status).toBe(400);
  });

  it('refuses to delete a model file outside the models directory', async () => {
    const res = await send('/api/ai/models/..%2F..%2Fsecret.gguf', 'DELETE');
    expect(res.status).toBe(400);
  });

  it('refuses chat with a clear reason instead of a stack trace', async () => {
    const res = await send('/api/ai/chat', 'POST', { text: 'what am I blocked on?' });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'ai_unavailable' });
  });

  it('repairs a missing runtime using the exact selected model already on disk', async () => {
    const file = 'already-downloaded.gguf';
    await fs.mkdir(ctx.paths.models, { recursive: true });
    await fs.writeFile(path.join(ctx.paths.models, file), 'model');
    await ctx.updateSettings({ modelFile: file });
    const install = vi.spyOn(ctx.ai, 'install').mockResolvedValue(file);

    const res = await send('/api/ai/install', 'POST', { file });

    expect(res.status).toBe(202);
    expect(install).toHaveBeenCalledWith(undefined, file);
  });

  it('does not repair from an unselected or missing model file', async () => {
    const res = await send('/api/ai/install', 'POST', { file: 'not-downloaded.gguf' });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'That model is not the selected downloaded model.',
      code: 'invalid',
    });
  });
});

/**
 * Comments are editable and removable from the UI, and only from the UI: these go through
 * `CommentTools`, which is deliberately not among the seven tools the model is given.
 */
describe('editing and removing a comment', () => {
  const withComments = async () => {
    const created = await (
      await send('/api/tasks', 'POST', { title: 'Commented' })
    ).json();
    const id = created.task.fields.id;
    await send(`/api/tasks/${id}/log`, 'POST', { text: 'first note' });
    await send(`/api/tasks/${id}/log`, 'POST', { text: 'second note' });
    return id;
  };

  it('edits one comment and leaves the other alone', async () => {
    const id = await withComments();
    const res = await send(`/api/tasks/${id}/log/0`, 'PATCH', { text: 'first, corrected' });
    expect(res.status).toBe(200);
    const task = (await res.json()).task;
    expect(task.log.map((e: { text: string }) => e.text)).toEqual([
      'first, corrected',
      'second note',
    ]);
  });

  it('keeps the comment its original timestamp — an edit fixes wording, not history', async () => {
    const id = await withComments();
    const before = (await (await get(`/api/tasks/${id}`)).json()).task.log[0].at;
    const after = (
      await (await send(`/api/tasks/${id}/log/0`, 'PATCH', { text: 'reworded' })).json()
    ).task.log[0].at;
    expect(after).toBe(before);
  });

  it('removes one comment', async () => {
    const id = await withComments();
    const res = await send(`/api/tasks/${id}/log/0`, 'DELETE');
    expect(res.status).toBe(200);
    expect((await res.json()).task.log.map((e: { text: string }) => e.text)).toEqual([
      'second note',
    ]);
  });

  it('refuses an index that is not there rather than touching the wrong one', async () => {
    const id = await withComments();
    expect((await send(`/api/tasks/${id}/log/9`, 'DELETE')).status).toBe(404);
    expect((await send(`/api/tasks/${id}/log/9`, 'PATCH', { text: 'x' })).status).toBe(404);
  });

  it('ticks a checkbox inside a comment, changing only those characters', async () => {
    const created = await (await send('/api/tasks', 'POST', { title: 'Boxes' })).json();
    const id = created.task.fields.id;
    await send(`/api/tasks/${id}/log`, 'POST', {
      text: 'Plan:\n- [ ] one\n- [x] two',
    });

    // What the UI sends: the same text with one box flipped.
    const res = await send(`/api/tasks/${id}/log/0`, 'PATCH', {
      text: 'Plan:\n- [x] one\n- [x] two',
    });
    expect(res.status).toBe(200);

    const raw = await (await get(`/api/tasks/${id}/raw`)).text();
    expect(raw).toContain('- [x] one');
    expect(raw).toContain('- [x] two');
    expect(raw).toContain('Plan:');
  });

  it('refuses to empty a comment, pointing at delete instead', async () => {
    const id = await withComments();
    const res = await send(`/api/tasks/${id}/log/0`, 'PATCH', { text: '   ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/needs some text/i);
  });

  it('leaves the description and the other comment byte-identical', async () => {
    const id = await withComments();
    await send(`/api/tasks/${id}`, 'PATCH', { field: 'description', value: 'Keep me exactly.' });
    await send(`/api/tasks/${id}/log/0`, 'PATCH', { text: 'changed' });
    const raw = await (await get(`/api/tasks/${id}/raw`)).text();
    expect(raw).toContain('Keep me exactly.');
    expect(raw).toContain('second note');
    expect(raw).not.toContain('first note');
  });
});

describe('a due date may carry a time', () => {
  const make = async (due: string) =>
    await send('/api/tasks', 'POST', { title: 'Timed', due });

  it('accepts a date on its own', async () => {
    const res = await make('2026-08-25');
    expect(res.status).toBe(201);
    expect((await res.json()).task.fields.due).toBe('2026-08-25');
  });

  it('accepts a date with a time, and stores it as written', async () => {
    const res = await make('2026-08-25T14:30');
    expect(res.status).toBe(201);
    expect((await res.json()).task.fields.due).toBe('2026-08-25T14:30');
  });

  it('accepts a space instead of the T, which is what people type', async () => {
    expect((await (await make('2026-08-25 14:30')).json()).task.fields.due).toBe(
      '2026-08-25T14:30',
    );
  });

  it('refuses a time that does not exist', async () => {
    expect((await make('2026-08-25T25:00')).status).toBe(400);
    expect((await make('2026-08-25T14:70')).status).toBe(400);
  });

  it('refuses a date that does not exist', async () => {
    expect((await make('2026-02-31')).status).toBe(400);
    expect((await make('not-a-date')).status).toBe(400);
  });
});

/**
 * Attachments are ordinary files in the workspace's own folder, linked from the markdown.
 * The parts worth pinning down are the boundaries: where bytes may land, and what may be
 * handed back inline.
 */
describe('attachments', () => {
  const upload = async (name: string, body: string, type = 'application/octet-stream') => {
    const form = new FormData();
    form.append('file', new File([body], name, { type }));
    return app.request('http://localhost/api/attachments', { method: 'POST', body: form });
  };

  it('saves a file and hands back the markdown to insert', async () => {
    const res = await upload('shot.png', 'not-really-a-png');
    expect(res.status).toBe(201);
    const { attachment } = await res.json();
    expect(attachment.name).toBe('shot.png');
    expect(attachment.markdown).toBe('![shot.png](attachments/shot.png)');
  });

  it('links rather than embeds anything that is not an image', async () => {
    const { attachment } = await (await upload('report.pdf', 'pdf-bytes')).json();
    expect(attachment.markdown).toBe('[report.pdf](attachments/report.pdf)');
  });

  it('puts the file in the workspace folder, where the link says it is', async () => {
    await upload('here.png', 'bytes');
    const onDisk = await fs.readFile(path.join(dir, 'main', 'attachments', 'here.png'), 'utf8');
    expect(onDisk).toBe('bytes');
  });

  it('never overwrites — the same name twice keeps both files', async () => {
    await upload('same.png', 'first');
    const { attachment } = await (await upload('same.png', 'second')).json();
    expect(attachment.name).toBe('same-1.png');
    expect(await fs.readFile(path.join(dir, 'main', 'attachments', 'same.png'), 'utf8')).toBe(
      'first',
    );
  });

  it('cannot be talked into writing outside the folder', async () => {
    const { attachment } = await (await upload('../../escaped.png', 'bytes')).json();
    expect(attachment.name).toBe('escaped.png');
    await expect(fs.access(path.join(dir, 'escaped.png'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'main', 'attachments', 'escaped.png'))).resolves
      .toBeUndefined();
  });

  it('refuses an empty upload', async () => {
    expect((await upload('empty.png', '')).status).toBe(400);
  });

  it('serves an image inline, with its real type', async () => {
    await upload('inline.png', 'bytes');
    const res = await get('/api/attachments/inline.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(res.headers.get('content-disposition')).toBeNull();
  });

  it('sends anything else as a download rather than rendering it here', async () => {
    await upload('page.html', '<script>alert(1)</script>');
    const res = await get('/api/attachments/page.html');
    expect(res.headers.get('content-type')).toContain('application/octet-stream');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('sends an svg as a download too — it is a document, not just a picture', async () => {
    await upload('logo.svg', '<svg onload="alert(1)"></svg>');
    const res = await get('/api/attachments/logo.svg');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('cannot be talked into reading outside the folder', async () => {
    expect((await get('/api/attachments/..%2F..%2Fboard.md')).status).toBe(404);
    expect((await get('/api/attachments/nothing-here.png')).status).toBe(404);
  });

  it('lists what the workspace holds', async () => {
    await upload('one.png', 'a');
    await upload('two.pdf', 'bb');
    const { attachments } = await (await get('/api/attachments')).json();
    expect(attachments.map((a: { name: string }) => a.name).sort()).toEqual(['one.png', 'two.pdf']);
    expect(attachments.find((a: { name: string }) => a.name === 'two.pdf').bytes).toBe(2);
  });
});
