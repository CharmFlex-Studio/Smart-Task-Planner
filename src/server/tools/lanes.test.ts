import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VaultStore } from '../vault/store.js';
import { PlannerTools } from './index.js';
import { LaneTools } from './lanes.js';
import { workspacePaths } from '../vault/workspaces.js';

let dir: string;
let store: VaultStore;
let lanes: LaneTools;
let tasks: PlannerTools;


beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanes-'));
  const paths = workspacePaths(dir, 'main');
  await fs.mkdir(paths.tasks, { recursive: true });
  await fs.mkdir(paths.archive, { recursive: true });
  store = new VaultStore(paths, 'main');
  await store.load();
  tasks = new PlannerTools(store);
  lanes = new LaneTools(store, tasks);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const ids = () => store.lanes().map((lane) => lane.id);
const names = () => store.lanes().map((lane) => lane.name);

describe('creating lanes', () => {
  it('appends a lane and gives it a slug id', async () => {
    const { board } = await lanes.create('Waiting on someone');
    expect(board.lanes.at(-1)).toEqual({ id: 'waiting-on-someone', name: 'Waiting on someone' });
  });

  it('inserts at a position when asked', async () => {
    await lanes.create('Triage', 0);
    expect(ids()[0]).toBe('triage');
  });

  it('never reuses an id, so two lanes with the same name stay distinct', async () => {
    await lanes.create('Todo');
    expect(ids()).toContain('todo-2');
  });

  it('refuses a blank name', async () => {
    await expect(lanes.create('   ')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses a name with no letters or digits to make an id from', async () => {
    await expect(lanes.create('!!!')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('survives a restart, because the lanes are a file', async () => {
    await lanes.create('Icebox');
    await store.load();
    expect(names()).toContain('Icebox');
  });
});

describe('renaming a lane', () => {
  it('changes the name and leaves the id — and so every task — alone', async () => {
    await tasks.createTask({ title: 'A', status: 'in-progress' }, true);
    await lanes.update('in-progress', { name: 'Doing' });

    expect(store.lanes().find((lane) => lane.id === 'in-progress')?.name).toBe('Doing');
    expect(store.list()[0]!.fields.status).toBe('in-progress');
    const raw = await fs.readFile(path.join(dir, 'main/tasks/a.md'), 'utf8');
    expect(raw).toContain('status: in-progress');
  });

  it('moves the done marker rather than having two of them', async () => {
    await lanes.update('review', { done: true });
    expect(store.lanes().filter((lane) => lane.done)).toHaveLength(1);
    expect(store.doneLaneId()).toBe('review');
  });

  it('reports a lane that is not there', async () => {
    await expect(lanes.update('nope', { name: 'X' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('deleting a lane', () => {
  it('moves its tasks to the lane before it', async () => {
    const created = await tasks.createTask({ title: 'Stranded', status: 'review' }, true);
    const { moved } = await lanes.remove('review');

    expect(moved).toBe(1);
    expect(ids()).not.toContain('review');
    expect(store.get(created.task.fields.id)!.fields.status).toBe('in-progress');
  });

  it('moves its tasks wherever it is told to', async () => {
    const created = await tasks.createTask({ title: 'Stranded', status: 'review' }, true);
    await lanes.remove('review', 'todo');
    expect(store.get(created.task.fields.id)!.fields.status).toBe('todo');
  });

  it('deletes an empty lane without touching a single task', async () => {
    const created = await tasks.createTask({ title: 'Elsewhere', status: 'todo' }, true);
    const { moved } = await lanes.remove('review');
    expect(moved).toBe(0);
    expect(store.get(created.task.fields.id)!.fields.status).toBe('todo');
  });

  it('refuses to empty a lane into itself', async () => {
    await expect(lanes.remove('todo', 'todo')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('refuses to remove the last lane, because a board needs one', async () => {
    await store.saveLanes([{ id: 'only', name: 'Only' }]);
    await expect(lanes.remove('only')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('reordering', () => {
  it('puts the lanes in the order given', async () => {
    await lanes.reorder(['done', 'review', 'in-progress', 'todo']);
    expect(ids()).toEqual(['done', 'review', 'in-progress', 'todo']);
  });

  it('keeps a lane the caller forgot instead of dropping it', async () => {
    await lanes.reorder(['done']);
    expect(ids()).toEqual(['done', 'todo', 'in-progress', 'review']);
  });

  it('ignores an id that is not a lane', async () => {
    await lanes.reorder(['done', 'made-up']);
    expect(ids()).toEqual(['done', 'todo', 'in-progress', 'review']);
  });
});
