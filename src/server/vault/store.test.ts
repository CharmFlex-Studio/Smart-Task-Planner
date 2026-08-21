import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VaultStore, ConflictError, NotFoundError } from './store.js';
import { workspacePaths } from './workspaces.js';

let dir: string;
let paths: ReturnType<typeof workspacePaths>;
let store: VaultStore;


beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-'));
  paths = workspacePaths(dir, 'main');
  await fs.mkdir(paths.tasks, { recursive: true });
  await fs.mkdir(paths.archive, { recursive: true });
  store = new VaultStore(paths, 'main');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const write = (rel: string, body: string) => fs.writeFile(path.join(dir, 'main', rel), body, 'utf8');

describe('loading', () => {
  it('indexes every markdown file under tasks/ and archive/', async () => {
    await write('tasks/a.md', '---\nid: a\ntitle: Alpha\n---\n');
    await write('tasks/b.md', '---\nid: b\ntitle: Beta\n---\n');
    await write('archive/c.md', '---\nid: c\ntitle: Gamma\n---\n');
    await store.load();
    expect(store.list().map((t) => t.fields.id).sort()).toEqual(['a', 'b', 'c']);
    expect(store.get('c')!.archived).toBe(true);
    expect(store.get('a')!.archived).toBe(false);
  });

  it('ignores non-markdown files and dotfiles', async () => {
    await write('tasks/notes.txt', 'hello');
    await write('tasks/.hidden.md', '---\nid: h\ntitle: H\n---\n');
    await write('tasks/a.md', '---\nid: a\ntitle: A\n---\n');
    await store.load();
    expect(store.list()).toHaveLength(1);
  });

  it('keeps a broken file visible rather than dropping it', async () => {
    await write('tasks/broken.md', '---\ntitle: [oops\n---\n\nbody\n');
    await store.load();
    const task = store.list()[0]!;
    expect(task.fields.title).toBe('broken');
    expect(store.problemsFor(task.fields.id).length).toBeGreaterThan(0);
  });

  it('recomputes derived signals on every read so they can never be stale', async () => {
    // `updated` is pinned in the file so the assertion does not depend on the file's mtime.
    await write('tasks/a.md', '---\nid: a\ntitle: A\nstatus: todo\nupdated: 2026-01-01T00:00:00\n---\n');
    await store.load();
    const early = store.get('a', new Date('2026-01-02T00:00:00'))!;
    const late = store.get('a', new Date('2026-01-10T00:00:00'))!;
    expect(late.derived.hoursSinceUpdate).toBeGreaterThan(early.derived.hoursSinceUpdate);
  });
});

describe('lanes', () => {
  it('uses the default lanes when the vault has no board file', async () => {
    await store.load();
    expect(store.lanes().map((lane) => lane.id)).toEqual(['todo', 'in-progress', 'review', 'done']);
    expect(store.isDoneLane('done')).toBe(true);
  });

  it('reads the lanes a board file names, in order', async () => {
    await write('board.md', '---\nlanes:\n  - id: now\n    name: Now\n  - id: shipped\n    name: Shipped\n    done: true\n---\n');
    await store.load();
    expect(store.lanes()).toEqual([
      { id: 'now', name: 'Now' },
      { id: 'shipped', name: 'Shipped', done: true },
    ]);
    expect(store.isDoneLane('shipped')).toBe(true);
    expect(store.isDoneLane('done')).toBe(false);
  });

  it('adds back a lane a task refers to but the board forgot, so no task can hide', async () => {
    await write('board.md', '---\nlanes:\n  - id: now\n    name: Now\n---\n');
    await write('tasks/a.md', '---\nid: a\ntitle: A\nstatus: someday\n---\n');
    await store.load();
    expect(store.lanes()).toEqual([
      { id: 'now', name: 'Now' },
      { id: 'someday', name: 'Someday' },
    ]);
  });

  it('falls back to the defaults for a board file it cannot read, and says why', async () => {
    await write('board.md', '---\nlanes: [oh: no\n---\n');
    await store.load();
    const board = store.boardView();
    expect(board.lanes.map((lane) => lane.id)).toEqual(['todo', 'in-progress', 'review', 'done']);
    expect(board.problems.length).toBeGreaterThan(0);
  });

  it('saves lanes as a file it can read back', async () => {
    await store.load();
    await store.saveLanes([
      { id: 'now', name: 'Now' },
      { id: 'later', name: 'Later' },
      { id: 'shipped', name: 'Shipped', done: true },
    ]);
    const raw = await fs.readFile(path.join(dir, 'main/board.md'), 'utf8');
    expect(raw).toContain('name: "Now"');
    await store.load();
    expect(store.lanes().map((lane) => lane.name)).toEqual(['Now', 'Later', 'Shipped']);
    expect(store.doneLaneId()).toBe('shipped');
  });
});

describe('writing', () => {
  beforeEach(async () => {
    await write('tasks/a.md', '---\nid: a\ntitle: Alpha\nstatus: active\n---\n\ndesc\n');
    await store.load();
  });

  it('writes atomically and reindexes', async () => {
    const before = store.get('a')!;
    await store.writeTask('a', (raw) => raw.replace('status: active', 'status: done'));
    expect(store.get('a')!.fields.status).toBe('done');
    expect(before.fields.status).toBe('active'); // the old projection was not mutated
    const onDisk = await fs.readFile(path.join(dir, 'main/tasks/a.md'), 'utf8');
    expect(onDisk).toContain('status: done');
  });

  it('leaves no temp files behind', async () => {
    await store.writeTask('a', (raw) => raw + 'x');
    const entries = await fs.readdir(paths.tasks);
    expect(entries).toEqual(['a.md']);
  });

  it('refuses to clobber a file that changed underneath it', async () => {
    await write('tasks/a.md', '---\nid: a\ntitle: Edited in Obsidian\n---\n');
    await expect(store.writeTask('a', (raw) => raw + 'x')).rejects.toBeInstanceOf(ConflictError);
    const onDisk = await fs.readFile(path.join(dir, 'main/tasks/a.md'), 'utf8');
    expect(onDisk).toContain('Edited in Obsidian');
  });

  it('a no-op write is not a conflict', async () => {
    await expect(store.writeTask('a', (raw) => raw)).resolves.toBeDefined();
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(store.writeTask('nope', (raw) => raw)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('creates a file with a slug filename, avoiding collisions', async () => {
    const one = await store.createTask('Alpha', '---\nid: n1\ntitle: Alpha\n---\n');
    const two = await store.createTask('Alpha', '---\nid: n2\ntitle: Alpha\n---\n');
    expect(one.path).toBe('main/tasks/alpha.md');
    expect(two.path).toBe('main/tasks/alpha-2.md');
  });

  it('moves a task to archive/ and back', async () => {
    await store.moveTask('a', true);
    expect(store.get('a')!.path).toBe('main/archive/a.md');
    expect(store.get('a')!.archived).toBe(true);
    await store.moveTask('a', false);
    expect(store.get('a')!.path).toBe('main/tasks/a.md');
  });
});

describe('search', () => {
  beforeEach(async () => {
    await write('tasks/a.md', '---\nid: a\ntitle: Fix the payment webhook\n---\n\n## Log\n\n- 2026-08-01 09:00 · blocker · waiting on merchant logs\n');
    await write('tasks/b.md', '---\nid: b\ntitle: Translation latency\ntags: [audio]\n---\n');
    await store.load();
  });

  it('matches titles', () => {
    expect(store.search('payment').map((m) => m.task.fields.id)).toEqual(['a']);
  });
  it('matches log text', () => {
    expect(store.search('merchant').map((m) => m.task.fields.id)).toEqual(['a']);
  });
  it('matches tags', () => {
    expect(store.search('audio').map((m) => m.task.fields.id)).toEqual(['b']);
  });
  it('ranks a title hit above a body hit', async () => {
    await write('tasks/c.md', '---\nid: c\ntitle: Something else\n---\n\nabout payment\n');
    await store.load();
    expect(store.search('payment')[0]!.task.fields.id).toBe('a');
  });
  it('returns nothing for an empty query', () => {
    expect(store.search('   ')).toEqual([]);
  });
});

describe('resolve', () => {
  beforeEach(async () => {
    await write('tasks/a.md', '---\nid: 01ABCDEF\ntitle: Fix the payment webhook\n---\n');
    await write('tasks/b.md', '---\nid: 01ZZZZZZ\ntitle: Translation latency\n---\n');
    await store.load();
  });

  it('resolves by exact id', () => {
    expect(store.resolve('01ABCDEF')!.fields.title).toBe('Fix the payment webhook');
  });
  it('resolves by exact title, case-insensitively', () => {
    expect(store.resolve('fix the payment webhook')!.fields.id).toBe('01ABCDEF');
  });
  it('resolves by a distinctive fragment of the title', () => {
    expect(store.resolve('payment')!.fields.id).toBe('01ABCDEF');
  });
  it('refuses an ambiguous fragment rather than guessing', async () => {
    await write('tasks/c.md', '---\nid: 01YYYYYY\ntitle: Payment retries\n---\n');
    await store.load();
    expect(store.resolve('payment')).toBeUndefined();
  });
  it('returns undefined for nonsense', () => {
    expect(store.resolve('zzzz nothing')).toBeUndefined();
  });
});
