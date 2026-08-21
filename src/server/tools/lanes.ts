/**
 * Lane operations: the write path for `board.md`.
 *
 * Deliberately separate from `PlannerTools`. The task tools double as the model's schema
 * and every extra entry there costs accuracy, so the model gets no way to restructure
 * someone's board — it can move a task between lanes and nothing more. These are UI-only.
 *
 * Deleting a lane always relocates its tasks first, through the normal task write path, so
 * a column can never take tasks with it when it goes.
 */

import type { Board, Lane } from '@shared/types.js';
import type { VaultStore } from '../vault/store.js';
import type { PlannerTools } from './index.js';
import { laneId, onlyOneDoneLane } from '../vault/board.js';
import { slugify } from '../vault/ids.js';
import { ToolError } from './errors.js';

const MAX_NAME = 40;

export interface LaneChange {
  board: Board;
  /** How many task files were rewritten to point at a different lane. */
  moved: number;
}

export class LaneTools {
  constructor(
    private readonly store: VaultStore,
    private readonly tasks: PlannerTools,
  ) {}

  list(): Board {
    return this.store.boardView();
  }

  async create(name: string, at?: number): Promise<LaneChange> {
    const clean = this.mustName(name);
    const lanes = this.store.lanes();
    const id = uniqueId(laneId(clean), lanes);
    const next = [...lanes];
    const index = at === undefined ? next.length : clamp(at, 0, next.length);
    next.splice(index, 0, { id, name: clean });
    return { board: await this.store.saveLanes(next), moved: 0 };
  }

  /** Rename, or move the "done" marker. The id never changes, so no task file is touched. */
  async update(id: string, patch: { name?: string; done?: boolean }): Promise<LaneChange> {
    const lanes = this.store.lanes();
    const target = this.mustLane(id, lanes);
    const name = patch.name === undefined ? target.name : this.mustName(patch.name);
    const done = patch.done === undefined ? target.done === true : patch.done;

    const next = lanes.map((lane) =>
      lane.id === target.id ? { id: lane.id, name, ...(done ? { done: true } : {}) } : lane,
    );
    // Marking a lane done unmarks whichever lane held it before.
    const resolved = done
      ? next.map((lane) => (lane.id === target.id ? lane : { id: lane.id, name: lane.name }))
      : next;
    return { board: await this.store.saveLanes(onlyOneDoneLane(resolved)), moved: 0 };
  }

  /**
   * Remove a lane, moving anything still in it. `moveTo` defaults to the lane before it,
   * because "where did my tasks go" should have an answer the user can predict.
   */
  async remove(id: string, moveTo?: string): Promise<LaneChange> {
    const lanes = this.store.lanes();
    const target = this.mustLane(id, lanes);
    if (lanes.length <= 1) {
      throw new ToolError('invalid', 'A board needs at least one lane.');
    }

    const index = lanes.findIndex((lane) => lane.id === target.id);
    const fallback = lanes[index - 1] ?? lanes[index + 1]!;
    const destination = moveTo ? this.mustLane(moveTo, lanes) : fallback;
    if (destination.id === target.id) {
      throw new ToolError('invalid', 'A lane cannot be emptied into itself.');
    }

    const stranded = this.store
      .list()
      .filter((task) => task.fields.status === target.id)
      .map((task) => task.fields.id);

    // Move first: while the lane still exists the normal task write path accepts the change,
    // and a failure here leaves the board untouched rather than half-migrated.
    for (const taskId of stranded) {
      await this.tasks.setField({ task: taskId, field: 'status', value: destination.id }, true);
    }

    const next = lanes.filter((lane) => lane.id !== target.id);
    return { board: await this.store.saveLanes(next), moved: stranded.length };
  }

  /** Reorder the columns. Any lane the caller forgot keeps its place at the end. */
  async reorder(ids: string[]): Promise<LaneChange> {
    const lanes = this.store.lanes();
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    const next: Lane[] = [];
    for (const id of ids) {
      const lane = byId.get(id);
      if (lane && !next.includes(lane)) next.push(lane);
    }
    for (const lane of lanes) if (!next.includes(lane)) next.push(lane);
    return { board: await this.store.saveLanes(next), moved: 0 };
  }

  private mustName(name: string): string {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) throw new ToolError('invalid', 'A lane needs a name.');
    if (clean.length > MAX_NAME) {
      throw new ToolError('invalid', `A lane name has to be ${MAX_NAME} characters or fewer.`);
    }
    // A name of nothing but emoji or punctuation has no slug, and so no id to store.
    if (!slugify(clean, '')) {
      throw new ToolError('invalid', `"${clean}" does not make a usable lane name.`);
    }
    return clean;
  }

  private mustLane(id: string, lanes: Lane[]): Lane {
    const wanted = String(id ?? '').trim().toLowerCase();
    const lane =
      lanes.find((l) => l.id.toLowerCase() === wanted) ??
      lanes.find((l) => l.name.toLowerCase() === wanted);
    if (!lane) {
      throw new ToolError(
        'not_found',
        `There is no lane called "${id}".`,
        `The board has: ${lanes.map((l) => l.name).join(', ')}.`,
      );
    }
    return lane;
  }
}

function uniqueId(base: string, lanes: Lane[]): string {
  const taken = new Set(lanes.map((lane) => lane.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
