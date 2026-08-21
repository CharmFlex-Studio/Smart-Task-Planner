/**
 * Lanes: the board's columns, and the only thing a task's `status:` field points at.
 *
 * They live in one plain file, `board.md` at the top of each workspace, because the rule
 * that the vault stays readable markdown applies to the board as much as to a task. Someone
 * who opens the folder in Obsidian can see what the columns are and rename one by typing.
 * The same file carries the workspace's display name, so renaming a workspace is one line
 * of one file and never moves a folder or touches a task.
 *
 * Parsing is tolerant in the same way task files are: a missing, empty or broken `board.md`
 * yields the default lanes rather than an exception, and any lane a task refers to but the
 * file does not mention is added back at read time. That last rule is what makes the board
 * self-healing — you cannot lose a task by deleting a line from this file.
 */

import { parse as parseYaml } from 'yaml';
import type { Lane } from '@shared/types.js';
import { slugify } from './ids.js';

/** The file's name inside a workspace folder. */
export const BOARD_FILE = 'board.md';

export const DEFAULT_LANES: readonly Lane[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'in-progress', name: 'In Progress' },
  { id: 'review', name: 'In Review' },
  { id: 'done', name: 'Done', done: true },
];

/** The lane a task lands in when its file says nothing. Always present after a merge. */
export const FALLBACK_LANE_ID = 'todo';

const BODY = `# Board

The columns of this workspace's board, in order.

- \`id\` is what a task's \`status:\` field holds. Renaming a lane leaves it alone, so
  renaming never touches a single task file.
- \`done: true\` marks the completion lane. Tasks there stop asking for attention.
- \`name\` is what this workspace is called. The folder name is its identity; this is only
  the label, so renaming costs one line here and nothing anywhere else.

Edit this file by hand or from the app — both end up in the same place.
`;

export interface ParsedBoard {
  /** The workspace's display name, when the file gives one. */
  name?: string;
  lanes: Lane[];
  /** Everything after the frontmatter, kept verbatim so a rewrite cannot eat someone's notes. */
  body: string;
  problems: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n([\s\S]*))?$/;

/** Turn any user text into a lane id that is safe in YAML and in a filename. */
export function laneId(name: string): string {
  return slugify(name, 'lane');
}

/** `in-progress` -> `In progress`, for a lane a task invented that the board never named. */
export function humanizeLaneId(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

function asLane(value: unknown, problems: string[]): Lane | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { id: laneId(name), name } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    problems.push('Ignoring a lane that is not a name or a key/value block.');
    return null;
  }
  const row = value as Record<string, unknown>;
  const name = String(row.name ?? row.title ?? row.id ?? '').trim();
  if (!name) {
    problems.push('Ignoring a lane with no name.');
    return null;
  }
  const id = String(row.id ?? '').trim() || laneId(name);
  return row.done === true ? { id, name, done: true } : { id, name };
}

/**
 * Read `board.md`. Returns the defaults for anything it cannot make sense of, because a
 * board that refuses to load is a board the user cannot fix from inside the app.
 */
export function parseBoardFile(raw: string | undefined): ParsedBoard {
  if (raw === undefined) return { lanes: [...DEFAULT_LANES], body: BODY, problems: [] };

  const problems: string[] = [];
  const match = raw.match(FRONTMATTER);
  const body = match ? (match[2] ?? '') : raw;
  const fallback = (): ParsedBoard => ({ lanes: [...DEFAULT_LANES], body, problems });

  if (!match) {
    problems.push('board.md has no frontmatter; using the default lanes.');
    return fallback();
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '');
  } catch (err) {
    problems.push(`board.md is not valid YAML (${(err as Error).message}); using the default lanes.`);
    return fallback();
  }

  const front = (parsed ?? {}) as { lanes?: unknown; name?: unknown };
  const name = typeof front.name === 'string' && front.name.trim() ? front.name.trim() : undefined;
  const rows = front.lanes;
  if (!Array.isArray(rows)) {
    problems.push('board.md has no `lanes:` list; using the default lanes.');
    return { ...fallback(), ...(name ? { name } : {}) };
  }

  const lanes: Lane[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const lane = asLane(row, problems);
    if (!lane) continue;
    if (seen.has(lane.id)) {
      problems.push(`Ignoring a second lane with the id "${lane.id}".`);
      continue;
    }
    seen.add(lane.id);
    lanes.push(lane);
  }

  if (lanes.length === 0) {
    problems.push('board.md lists no usable lanes; using the default lanes.');
    return { ...fallback(), ...(name ? { name } : {}) };
  }
  return { lanes: onlyOneDoneLane(lanes), body, problems, ...(name ? { name } : {}) };
}

/** At most one completion lane, so "is this finished" always has one answer. */
export function onlyOneDoneLane(lanes: Lane[]): Lane[] {
  let claimed = false;
  return lanes.map((lane) => {
    if (!lane.done) return { id: lane.id, name: lane.name };
    if (claimed) return { id: lane.id, name: lane.name };
    claimed = true;
    return { id: lane.id, name: lane.name, done: true };
  });
}

/**
 * Add back any lane a task file refers to but the board does not list, so a hand-typed
 * `status: someday` shows up as a column instead of the task vanishing.
 */
export function mergeLanes(lanes: Lane[], statusesInUse: Iterable<string>): Lane[] {
  const known = new Set(lanes.map((lane) => lane.id));
  const extra: Lane[] = [];
  for (const status of statusesInUse) {
    const id = status.trim();
    if (!id || known.has(id)) continue;
    known.add(id);
    extra.push({ id, name: humanizeLaneId(id) });
  }
  return extra.length ? [...lanes, ...extra] : lanes;
}

/**
 * Rewrite the frontmatter, keeping whatever prose the file already had. The app owns the
 * `name:` and `lanes:` block; everything below the fence belongs to whoever typed it.
 */
export function serializeBoardFile(
  lanes: Lane[],
  name?: string,
  body: string = BODY,
): string {
  const rows = onlyOneDoneLane(lanes).map((lane) => {
    const done = lane.done ? '\n    done: true' : '';
    return `  - id: ${JSON.stringify(lane.id)}\n    name: ${JSON.stringify(lane.name)}${done}`;
  });
  const front = [...(name ? [`name: ${JSON.stringify(name)}`] : []), 'lanes:', ...rows];
  const tail = body.trim() ? body.replace(/^\n+/, '') : '';
  return ['---', ...front, '---', '', tail].join('\n');
}
