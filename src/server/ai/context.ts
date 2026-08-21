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
/**
 * How many tasks sit in each column, counted here so the model never has to.
 *
 * The index below is not a countable thing: it holds open tasks only, and it stops at forty.
 * Asking a model "how many are in Done" against a list containing no done tasks gets a
 * confident zero, and asking it to count forty lines gets a number that is off by two — the
 * same reason "Overdue by 2 days" is worked out here rather than left as date arithmetic.
 *
 * Counted over every file in the workspace, so it stays right however long the board grows.
 */
export function laneTally(tasks: Task[], lanes: Lane[] = []): string {
  const live = tasks.filter((t) => !t.archived);

  const counts = new Map<string, number>();
  for (const task of live) {
    counts.set(task.fields.status, (counts.get(task.fields.status) ?? 0) + 1);
  }

  const rows = lanes.map((lane) => `- ${lane.name}: ${counts.get(lane.id) ?? 0}`);
  // A status no lane claims still gets a row. Its tasks are real and on the board — the
  // board view merges such a lane back in — so leaving them out would make the rows
  // disagree with the total, which is worse than an oddly-named column.
  for (const [status, count] of counts) {
    if (!lanes.some((lane) => lane.id === status)) rows.push(`- ${status}: ${count}`);
  }

  const doneLaneId = lanes.find((lane) => lane.done)?.id;
  const done = doneLaneId === undefined ? 0 : (counts.get(doneLaneId) ?? 0);
  const archived = tasks.length - live.length;

  const summary =
    `${live.length - done} open, ${done} done, ${live.length} on the board.` +
    (archived > 0 ? ` ${archived} archived, not counted above.` : '');

  return [...rows, summary].join('\n');
}

export function taskIndex(tasks: Task[], lanes: Lane[] = []): string {
  const name = laneNamer(lanes);
  const live = tasks
    .filter((t) => !t.archived && t.derived.momentum !== 'done')
    .sort((a, b) => a.derived.hoursSinceUpdate - b.derived.hoursSinceUpdate)
    .slice(0, MAX_INDEX_TASKS);

  if (live.length === 0) return 'There are no open tasks.';

  const open = tasks.filter((t) => !t.archived && t.derived.momentum !== 'done').length;
  // Saying "these are all of them" when they are not is how a model comes to tell
  // someone a task does not exist, having simply never been shown it.
  const truncated =
    open > live.length
      ? `\n(${open - live.length} more open tasks are not listed here. Use search_tasks or list_tasks to reach them.)`
      : '';

  return live
    .map((t) => {
      const bits = [`[${name(t.fields.status)}]`, t.derived.momentum];
      bits.push(`last touched ${describeHours(t.derived.hoursSinceUpdate)}`);
      if (t.fields.due) bits.push(`due ${t.fields.due}`);
      // The reasons are already worked out — "Overdue by 2 days", "No update for 9 days".
      // Handing them over as facts saves the model doing date arithmetic across forty
      // rows, which is exactly the sort of counting a small one gets wrong.
      if (t.derived.attentionReasons.length) bits.push(...t.derived.attentionReasons);
      return `- "${t.fields.title}" ${bits.join(', ')}`;
    })
    .join('\n') + truncated;
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

WHAT YOU CAN SEE, AND WHAT YOU CANNOT
The list at the end of this message is an INDEX. For each task it gives the title, which
column it is in, how recently it was touched, its due date, and — already worked out for
you — why it wants attention, in words like "Overdue by 2 days" or "No update for 9 days".
That is all it holds.

It does NOT hold descriptions, comments, or any history. Those are in the files, and a
tool call is the only way to read them.

USE A TOOL WHEN
- The question is about details, reasons, history, or what happened -> call get_task.
- The user names something that is not in the index -> call search_tasks.
- You are about to say you do not know something about a task that IS in the index
  -> call get_task first. The answer is probably in its comments.

Answering that kind of question from the index alone is guessing, and guessing is the one
thing you must never do here. Two examples of the shape:

  "where did the billing work get to?"
  -> get_task("Ship the billing migration"), then answer from its comments.

  "what is blocking the payments work?"
  -> search_tasks("payments"), then get_task on the one in Blocked.

You do not need a tool for questions the index already answers. What is overdue, what has
gone stale, which tasks are in a column: read them off the index. Do not work out dates
yourself — every "Overdue by" and "No update for" below is already correct, and recomputing
them from today's date is how you get the number wrong.

HOW MANY
Never count the index. It lists open tasks only, it stops at forty, and counting its lines
is how you end up telling someone Done is empty when eleven tasks are sitting in it.

TASK COUNTS below is computed from every file in the workspace and is exact. Any question
of the form "how many" — in a column, open, done, altogether — is answered by reading one
number off it. If a column is not listed there, it has no tasks.

WHERE YOU ARE
You are working in the "${workspace}" workspace. The user may keep other workspaces; you
cannot see them, search them or change them. If they ask about work that is not here, say
it is not in this workspace rather than guessing where it went.

HOW YOU WORK
- Never invent progress, dates or decisions. If you do not know, say so — or call a tool.
- Be brief. Two or three sentences is usually right. No preamble, no restating the question.
- To record work, prefer add_log over changing fields. The comment history is the point of this planner.
- The board's columns are: ${lanes.map((lane) => lane.name).join(' / ')}. Moving a task means set_field with field "status".
- Never invent a column. If the user asks for one that does not exist, say so — you cannot edit the board.
- Refer to tasks by their title. Never show ids to the user.
- Dates and staleness are given to you already computed. Do not recalculate them.

WRITES NEED PERMISSION
Any tool that changes a task is shown to the user as a diff they must approve. Nothing you do is saved unless they click Apply.

So: make the call once, then describe it as something you have DRAFTED or PROPOSED, waiting for them. Say "I've drafted a progress note for X" or "Here's the change for you to approve".

Never say "I have recorded", "I have saved", "I have updated", "done", or anything else implying the change already happened. It has not. Do not repeat a call you have already made.

TASK COUNTS IN "${workspace}" (exact, every file counted)
${laneTally(tasks, lanes)}

INDEX OF OPEN TASKS IN "${workspace}"
${taskIndex(tasks, lanes)}`;
}
