import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyLegacyMigration,
  discoverWorkspaceIds,
  humanizeWorkspaceId,
  planLegacyMigration,
  workspaceId,
  workspaceOfBoardPath,
  workspaceOfPath,
  workspacePaths,
} from './workspaces.js';

describe('reading a path', () => {
  it('reads the folder name of the workspace', () => {
    expect(workspaceOfPath('work/tasks/a.md')).toEqual({ workspace: 'work', archived: false });
    expect(workspaceOfPath('work/archive/a.md')).toEqual({ workspace: 'work', archived: true });
  });

  it('follows a task into a subfolder of tasks/', () => {
    expect(workspaceOfPath('work/tasks/2026/a.md')).toEqual({ workspace: 'work', archived: false });
  });

  it('is not fooled by a markdown file that is not a task', () => {
    expect(workspaceOfPath('notes.md')).toBeNull();
    expect(workspaceOfPath('work/board.md')).toBeNull();
    expect(workspaceOfPath('work/notes/a.md')).toBeNull();
    expect(workspaceOfPath('.planner/cache/a.md')).toBeNull();
  });

  it('claims nothing at the top of the vault, which is the old layout', () => {
    expect(workspaceOfPath('tasks/a.md')).toBeNull();
    expect(workspaceOfPath('archive/a.md')).toBeNull();
  });

  it('recognises a board file, and only a board file', () => {
    expect(workspaceOfBoardPath('work/board.md')).toBe('work');
    expect(workspaceOfBoardPath('board.md')).toBeNull();
    expect(workspaceOfBoardPath('work/tasks/board.md')).toBeNull();
    expect(workspaceOfBoardPath('boarding.md')).toBeNull();
  });
});

describe('naming', () => {
  it('turns a name into a folder name', () => {
    expect(workspaceId('Product Design')).toBe('product-design');
    expect(workspaceId('  Work  ')).toBe('work');
  });

  it('gives back nothing for a name with no folder name in it', () => {
    expect(workspaceId('🌱')).toBe('');
  });

  it('reads a folder nobody named as a title', () => {
    expect(humanizeWorkspaceId('product-design')).toBe('Product design');
    expect(humanizeWorkspaceId('work')).toBe('Work');
  });
});

describe('discovery', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-'));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('names a default workspace for an empty vault rather than none at all', async () => {
    expect(await discoverWorkspaceIds(dir)).toEqual(['main']);
  });

  it('finds folders that hold a board or tasks, alphabetically', async () => {
    await fs.mkdir(path.join(dir, 'work/tasks'), { recursive: true });
    await fs.writeFile(path.join(dir, 'admin.board'), '');
    await fs.mkdir(path.join(dir, 'admin'), { recursive: true });
    await fs.writeFile(path.join(dir, 'admin/board.md'), '---\nlanes: []\n---\n');

    expect(await discoverWorkspaceIds(dir)).toEqual(['admin', 'work']);
  });

  it('ignores a folder that is neither, so a vault can hold other things', async () => {
    await fs.mkdir(path.join(dir, 'work/tasks'), { recursive: true });
    await fs.mkdir(path.join(dir, 'attachments'), { recursive: true });
    await fs.mkdir(path.join(dir, '.planner'), { recursive: true });

    expect(await discoverWorkspaceIds(dir)).toEqual(['work']);
  });

  it('never mistakes the old layout for a workspace called tasks', async () => {
    await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
    await fs.mkdir(path.join(dir, 'archive'), { recursive: true });
    expect(await discoverWorkspaceIds(dir)).toEqual(['main']);
  });

  it('lays every workspace folder out the same way', () => {
    const main = workspacePaths('/v', 'main');
    const work = workspacePaths('/v', 'work');
    expect(main.tasks).toBe(path.join('/v', 'main', 'tasks'));
    expect(main.board).toBe(path.join('/v', 'main', 'board.md'));
    expect(work.tasks).toBe(path.join('/v', 'work', 'tasks'));
    expect(work.board).toBe(path.join('/v', 'work', 'board.md'));
    expect(work.vault).toBe('/v');
  });
});

describe('moving a vault that predates workspaces', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-'));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  const legacy = async (board?: string) => {
    await fs.mkdir(path.join(dir, 'tasks'), { recursive: true });
    await fs.mkdir(path.join(dir, 'archive'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tasks/a.md'), '---\nid: a\ntitle: A\n---\n');
    if (board !== undefined) await fs.writeFile(path.join(dir, 'board.md'), board);
  };

  it('has nothing to do for a vault that is already folders', async () => {
    await fs.mkdir(path.join(dir, 'work/tasks'), { recursive: true });
    expect(await planLegacyMigration(dir)).toBeNull();
  });

  it('moves the three top-level entries into one folder', async () => {
    await legacy('---\nlanes: []\n---\n');
    const plan = (await planLegacyMigration(dir))!;

    expect(plan.workspace).toBe('main');
    expect(plan.moves).toEqual([
      { from: 'tasks', to: 'main/tasks' },
      { from: 'archive', to: 'main/archive' },
      { from: 'board.md', to: 'main/board.md' },
    ]);

    await applyLegacyMigration(dir, plan);
    expect(await fs.readFile(path.join(dir, 'main/tasks/a.md'), 'utf8')).toContain('title: A');
    await expect(fs.access(path.join(dir, 'tasks'))).rejects.toThrow();
    expect(await discoverWorkspaceIds(dir)).toEqual(['main']);
  });

  it('keeps the name the old board gave itself, and names the folder after it', async () => {
    await legacy('---\nname: "Personal notes"\nlanes: []\n---\n');
    const plan = (await planLegacyMigration(dir))!;

    expect(plan).toMatchObject({ workspace: 'personal-notes', name: 'Personal notes' });
    await applyLegacyMigration(dir, plan);
    expect(await fs.readFile(path.join(dir, 'personal-notes/board.md'), 'utf8')).toContain(
      'name: "Personal notes"',
    );
  });

  it('moves what is there when the board file is missing', async () => {
    await legacy();
    const plan = (await planLegacyMigration(dir))!;
    expect(plan.moves.map((m) => m.from)).toEqual(['tasks', 'archive']);
    await applyLegacyMigration(dir, plan);
    expect(await fs.readFile(path.join(dir, 'main/tasks/a.md'), 'utf8')).toContain('title: A');
  });

  it('never moves onto a folder that is already there', async () => {
    await legacy('---\nlanes: []\n---\n');
    await fs.mkdir(path.join(dir, 'main/tasks'), { recursive: true });
    await fs.writeFile(path.join(dir, 'main/tasks/existing.md'), '---\nid: e\ntitle: E\n---\n');

    const plan = (await planLegacyMigration(dir))!;
    expect(plan.workspace).toBe('main-2');

    await applyLegacyMigration(dir, plan);
    expect(await fs.readFile(path.join(dir, 'main/tasks/existing.md'), 'utf8')).toContain('title: E');
    expect(await fs.readFile(path.join(dir, 'main-2/tasks/a.md'), 'utf8')).toContain('title: A');
  });
});
