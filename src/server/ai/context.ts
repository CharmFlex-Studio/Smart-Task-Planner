import type { Lane, Task } from '@shared/types.js';

/**
 * Preparing context is most of the quality.
 *
 * A small model asked "here are six months of updates, tell me what happened" will invent
 * things. The same model given a tidy, pre-digested slice answers well. So everything the
 * model sees is shaped here: compact, labelled, and small enough to leave room to think.
 *
 * The other half of the rule is that objective facts are computed, never inferred. Dates,
 * staleness and which column a task sits in are handed to the model as text; it is never
 * asked to work them out.
 */

const MAX_INDEX_TASKS = 40;
const MAX_LOG_LINES = 20;

const dateLine = (now: Date) =>
  now.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

/** One line per task: enough to refer to it, not enough to reason about it. */
export function taskIndex(tasks: Task[], lanes: Lane[] = []): string {
  const name = laneNamer(lanes);
  const live = tasks
    .filter((t) => !t.archived && t.derived.momentum !== 'done')
    .sort((a, b) => a.derived.hoursSinceUpdate - b.derived.hoursSinceUpdate)
    .slice(0, MAX_INDEX_TASKS);

  if (live.length === 0) return 'There are no open tasks.';

  return live
    .map((t) => {
      const bits = [`[${name(t.fields.status)}]`, t.derived.momentum];
      bits.push(`last touched ${describeHours(t.derived.hoursSinceUpdate)}`);
      if (t.fields.due) bits.push(`due ${t.fields.due}`);
      return `- "${t.fields.title}" ${bits.join(', ')}`;
    })
    .join('\n');
}

export function describeHours(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Lane ids mean nothing to a reader; the column name does. */
function laneNamer(lanes: Lane[]): (id: string) => string {
  const byId = new Map(lanes.map((lane) => [lane.id, lane.name]));
  return (id) => byId.get(id) ?? id;
}

/** The full detail of one task, for when the model has chosen to look at it. */
export function renderTask(task: Task, lanes: Lane[] = [], maxLines = MAX_LOG_LINES): string {
  const f = task.fields;
  const name = laneNamer(lanes);
  const lines = [
    `TASK: ${f.title}`,
    `COLUMN: ${name(f.status)}`,
    f.due ? `DUE: ${f.due}` : null,
    `MOMENTUM: ${task.derived.momentum}, last touched ${describeHours(task.derived.hoursSinceUpdate)}`,
    task.description ? `DESCRIPTION: ${task.description}` : null,
  ].filter(Boolean) as string[];

  const log = [...task.log].sort((a, b) => a.at.localeCompare(b.at));
  const shown = log.slice(-maxLines);
  if (log.length > shown.length) {
    lines.push(`(${log.length - shown.length} older entries omitted)`);
  }
  lines.push('LOG:');
  lines.push(
    shown.length
      ? shown.map((e) => `  ${e.at.replace('T', ' ')} ${e.type}: ${e.text}`).join('\n')
      : '  (no entries yet)',
  );
  return lines.join('\n');
}

/** A compact result set, for list and search tool replies. */
export function renderList(tasks: Task[], lanes: Lane[] = [], limit = 25): string {
  if (tasks.length === 0) return 'No tasks matched.';
  const name = laneNamer(lanes);
  const shown = tasks.slice(0, limit);
  const more = tasks.length > shown.length ? `\n(${tasks.length - shown.length} more not shown)` : '';
  return (
    shown
      .map((t) => `- "${t.fields.title}" [${name(t.fields.status)}] ${t.derived.momentum}`)
      .join('\n') + more
  );
}

export function systemPrompt(
  tasks: Task[],
  lanes: Lane[],
  workspace: string,
  now: Date,
): string {
  return `You are the assistant inside a local task planner. Everything you see is the user's own private notes, stored as markdown files on their machine.

Today is ${dateLine(now)}.

WHERE YOU ARE
You are working in the "${workspace}" workspace, and the tasks below are all of it. The user may keep other workspaces; you cannot see them, search them or change them. If they ask about work that is not here, say it is not in this workspace rather than guessing where it went.

HOW YOU WORK
- Answer from the task data only. If the data does not say something, say that you do not know rather than guessing. Never invent progress, dates or decisions.
- Be brief. Two or three sentences is usually right. No preamble, no restating the question.
- To record work, prefer add_log over changing fields. The comment history is the point of this planner.
- The board's columns are: ${lanes.map((lane) => lane.name).join(' / ')}. Moving a task means set_field with field "status".
- Never invent a column. If the user asks for one that does not exist, say so — you cannot edit the board.
- Use get_task before summarizing a specific task, so you are working from its real log.
- Refer to tasks by their title. Never show ids to the user.
- Dates and staleness are given to you already computed. Do not recalculate them.

WRITES NEED PERMISSION
Any tool that changes a task is shown to the user as a diff they must approve. Nothing you do is saved unless they click Apply.

So: make the call once, then describe it as something you have DRAFTED or PROPOSED, waiting for them. Say "I've drafted a progress note for X" or "Here's the change for you to approve".

Never say "I have recorded", "I have saved", "I have updated", "done", or anything else implying the change already happened. It has not. Do not repeat a call you have already made.

OPEN TASKS IN "${workspace}"
${taskIndex(tasks, lanes)}`;
}
