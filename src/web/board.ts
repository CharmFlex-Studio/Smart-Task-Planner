import type { Lane, Task } from '@shared/types.js';

/**
 * The board is a projection of the markdown files onto the lanes in `board.md`. It never
 * invents ordering state of its own: a column is "the open tasks whose status is this lane",
 * newest activity first, and nothing about that is stored anywhere.
 */

export interface Column {
  lane: Lane;
  tasks: Task[];
}

/** Open tasks matching the filter. Archived work is out of the board's scope entirely. */
export function boardTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (task.archived) return false;
    if (!q) return true;
    return [
      task.fields.title,
      task.description,
      ...(task.fields.tags ?? []),
      ...task.log.map((entry) => entry.text),
    ].some((text) => text.toLowerCase().includes(q));
  });
}

export function buildColumns(tasks: Task[], lanes: Lane[], query: string): Column[] {
  const byLane = new Map<string, Task[]>(lanes.map((lane) => [lane.id, []]));
  for (const task of boardTasks(tasks, query)) {
    // A task whose lane vanished mid-session lands in the first column rather than nowhere.
    const bucket = byLane.get(task.fields.status) ?? byLane.get(lanes[0]?.id ?? '');
    bucket?.push(task);
  }
  for (const list of byLane.values()) list.sort(byRecency);
  return lanes.map((lane) => ({ lane, tasks: byLane.get(lane.id) ?? [] }));
}

function byRecency(a: Task, b: Task): number {
  return a.derived.hoursSinceUpdate - b.derived.hoursSinceUpdate;
}

export function laneName(lanes: Lane[], id: string): string {
  return lanes.find((lane) => lane.id === id)?.name ?? id;
}
