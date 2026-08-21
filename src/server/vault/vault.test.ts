import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault, UnknownWorkspaceError } from './vault.js';
import { resolvePaths } from '../config.js';

let dir: string;
let vault: Vault;

const write = async (rel: string, body: string) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), body, 'utf8');
};

const task = (id: string, title: string, status = 'todo') =>
  `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n---\n`;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-'));
  vault = new Vault(resolvePaths({ PLANNER_VAULT: dir, PLANNER_HOME: path.join(dir, '.app') }));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('loading a vault of workspaces', () => {
  it("indexes each workspace's folder separately", async () => {
    await write('main/tasks/a.md', task('a', 'Main thing'));
    await write('work/tasks/b.md', task('b', 'Work thing'));
    await write('work/archive/c.md', task('c', 'Old work thing'));
    await vault.load();

    expect(vault.ids()).toEqual(['main', 'work']);
    expect(vault.store('main').list().map((t) => t.fields.id)).toEqual(['a']);
    expect(vault.store('work').list().map((t) => t.fields.id).sort()).toEqual(['b', 'c']);
    expect(vault.size).toBe(3);
  });

  it('keeps vault-relative paths, so a task says which folder it is in', async () => {
    await write('work/tasks/b.md', task('b', 'Work thing'));
    await vault.load();
    expect(vault.store('work').get('b')!.path).toBe('work/tasks/b.md');
  });

  it('gives each workspace its own lanes', async () => {
    await write('main/tasks/a.md', task('a', 'Main thing'));
    await write('work/board.md', '---\nname: "Work"\nlanes:\n  - id: now\n    name: Now\n---\n');
    await vault.load();

    expect(vault.store('main').lanes().map((l) => l.id)).toEqual(['todo', 'in-progress', 'review', 'done']);
    expect(vault.store('work').lanes().map((l) => l.id)).toEqual(['now']);
  });

  it("reads each workspace's name from its own board file", async () => {
    await write('main/board.md', '---\nname: "Personal"\nlanes:\n  - id: todo\n    name: To Do\n---\n');
    await write('work/tasks/b.md', task('b', 'Work thing'));
    await vault.load();

    expect(vault.summaries()).toEqual([
      { id: 'main', name: 'Personal', taskCount: 0 },
      { id: 'work', name: 'Work', taskCount: 1 },
    ]);
  });
});

describe('a workspace cannot see another', () => {
  beforeEach(async () => {
    await write('main/tasks/secret.md', task('secret', 'Salary review notes'));
    await write('work/tasks/ship.md', task('ship', 'Ship the release'));
    await vault.load();
  });

  it('lists only its own tasks', () => {
    expect(vault.store('work').list().map((t) => t.fields.title)).toEqual(['Ship the release']);
  });

  it("cannot get another workspace's task by id", () => {
    expect(vault.store('work').get('secret')).toBeUndefined();
    expect(vault.store('main').get('ship')).toBeUndefined();
  });

  it("cannot resolve another workspace's task by title", () => {
    expect(vault.store('work').resolve('Salary review notes')).toBeUndefined();
    expect(vault.store('work').resolve('salary')).toBeUndefined();
  });

  it('cannot search another workspace', () => {
    expect(vault.store('work').search('salary')).toEqual([]);
    expect(vault.store('work').search('ship').map((m) => m.task.fields.id)).toEqual(['ship']);
  });

  it("cannot read another workspace's file text", () => {
    expect(vault.store('work').rawOf('secret')).toBeUndefined();
    expect(vault.store('work').rawOfPath('tasks/secret.md')).toBeUndefined();
  });

  it('refuses to write to a task it cannot see', async () => {
    await expect(vault.store('work').writeTask('secret', (raw) => raw)).rejects.toThrow();
    await expect(vault.store('work').deleteTask('secret')).rejects.toThrow();
  });
});

describe('choosing a workspace', () => {
  beforeEach(async () => {
    await write('main/tasks/a.md', task('a', 'Main thing'));
    await write('work/tasks/b.md', task('b', 'Work thing'));
    await vault.load();
  });

  it('defaults to the first one when asked for nothing', () => {
    expect(vault.resolveId(undefined)).toBe('main');
    expect(vault.resolveId('')).toBe('main');
  });

  it('moves the default on when that workspace is gone', async () => {
    await fs.rm(path.join(dir, 'main'), { recursive: true, force: true });
    await vault.load();
    expect(vault.resolveId(undefined)).toBe('work');
  });

  it('refuses an id it does not have rather than quietly showing another', () => {
    expect(() => vault.resolveId('nope')).toThrow(UnknownWorkspaceError);
    expect(() => vault.store('nope')).toThrow(UnknownWorkspaceError);
  });
});

describe('creating, renaming and removing', () => {
  beforeEach(async () => {
    await write('main/tasks/a.md', task('a', 'Main thing'));
    await vault.load();
  });

  it('creates a folder with a board and two subfolders', async () => {
    const created = await vault.createWorkspace('product-design', 'Product Design');
    expect(created).toEqual({ id: 'product-design', name: 'Product Design', taskCount: 0 });

    expect((await fs.stat(path.join(dir, 'product-design/tasks'))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(dir, 'product-design/archive'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(dir, 'product-design/board.md'), 'utf8')).toContain(
      'name: "Product Design"',
    );
    expect(vault.ids()).toEqual(['main', 'product-design']);
  });

  it('renames without moving the folder or touching a task', async () => {
    await vault.createWorkspace('work', 'Work');
    await write('work/tasks/b.md', task('b', 'Work thing'));
    await vault.load();
    const before = await fs.readFile(path.join(dir, 'work/tasks/b.md'), 'utf8');

    await vault.renameWorkspace('work', 'Client work');

    expect(vault.store('work').name).toBe('Client work');
    expect((await fs.stat(path.join(dir, 'work'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(dir, 'work/tasks/b.md'), 'utf8')).toBe(before);
  });

  it('keeps the lanes and the prose when it renames', async () => {
    await vault.createWorkspace('work', 'Work');
    await vault.store('work').saveLanes([{ id: 'now', name: 'Now' }]);
    await vault.renameWorkspace('work', 'Client work');

    const raw = await fs.readFile(path.join(dir, 'work/board.md'), 'utf8');
    expect(raw).toContain('name: "Client work"');
    expect(raw).toContain('id: "now"');
    expect(raw).toContain('# Board');
    expect(vault.store('work').lanes().map((l) => l.id)).toEqual(['now']);
  });

  it('removes an empty workspace', async () => {
    await vault.createWorkspace('work', 'Work');
    await vault.removeWorkspace('work');
    expect(vault.ids()).toEqual(['main']);
    await expect(fs.access(path.join(dir, 'work'))).rejects.toThrow();
  });

  it('refuses to remove one that still holds tasks', async () => {
    await vault.createWorkspace('work', 'Work');
    await write('work/tasks/b.md', task('b', 'Work thing'));
    await vault.load();

    await expect(vault.removeWorkspace('work')).rejects.toThrow(/still has tasks/);
    expect((await fs.stat(path.join(dir, 'work/tasks/b.md'))).isFile()).toBe(true);
  });

  it('refuses to remove the last one, because the vault needs somewhere to put a task', async () => {
    await expect(vault.removeWorkspace('main')).rejects.toThrow(/at least one/i);
  });

  it('will remove any workspace, including the one the vault started with', async () => {
    await vault.createWorkspace('work', 'Work');
    await fs.rm(path.join(dir, 'main/tasks/a.md'), { force: true });
    await vault.load();

    await vault.removeWorkspace('main');
    expect(vault.ids()).toEqual(['work']);
  });
});

describe('picking up changes from the filesystem', () => {
  beforeEach(async () => {
    await write('main/tasks/a.md', task('a', 'Main thing'));
    await vault.load();
  });

  it('routes a changed file to the workspace that owns it', async () => {
    await write('work/tasks/b.md', task('b', 'Work thing'));
    const change = await vault.syncPath('work/tasks/b.md');

    expect(change).toMatchObject({ kind: 'task', workspace: 'work' });
    expect(vault.store('work').get('b')!.fields.title).toBe('Work thing');
  });

  it('notices a workspace someone created in their file manager', async () => {
    await write('work/tasks/b.md', task('b', 'Work thing'));
    await vault.syncPath('work/tasks/b.md');
    expect(vault.ids()).toEqual(['main', 'work']);
  });

  it('rereads a board file that was edited by hand', async () => {
    await write('main/board.md', '---\nname: "Renamed by hand"\nlanes:\n  - id: now\n    name: Now\n---\n');
    const change = await vault.syncPath('main/board.md');

    expect(change).toEqual({ kind: 'board', workspace: 'main' });
    expect(vault.store('main').name).toBe('Renamed by hand');
  });

  it('ignores a markdown file that is not a task', async () => {
    await write('notes.md', '# just a note\n');
    expect(await vault.syncPath('notes.md')).toEqual({ kind: 'ignored' });
  });
});
