/**
 * Everything the planner knows that is not written down.
 *
 * Momentum, staleness and attention are *derived at read time* from the fields and the
 * log — never stored. That is a deliberate trade: it costs a few microseconds per task and
 * buys us a vault that can never hold a stale cached signal, and a set of rules that can
 * be changed without migrating a single file.
 *
 * Whether a task is finished is not something these functions can work out on their own,
 * because "finished" is whichever lane the user marked `done` on their board. It is passed
 * in. Everything else here is a pure function of the file, and every function takes `now`
 * explicitly so thresholds are testable on both sides of each boundary.
 */

import type { DerivedSignals, LogEntry, Momentum, TaskFields } from '@shared/types.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Hours after which a task stops counting as actively moving. */
const MOVING_HOURS = 24;
/** Hours after which a task is stalled rather than merely slowing. */
const SLOWING_HOURS = 72;
/** Days without an update before staleness is worth surfacing. */
const STALE_ATTENTION_DAYS = 3;

function parseTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Due dates are calendar days in the user's own timezone, never UTC instants. */
function parseDueDate(value: string | undefined): Date | undefined {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Calendar days between two instants, DST-safe. */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/** The newest entry by timestamp — the log is not guaranteed to be in order. */
export function newestEntry(log: LogEntry[]): LogEntry | undefined {
  let best: LogEntry | undefined;
  let bestAt = -Infinity;
  for (const entry of log) {
    const t = parseTime(entry.at)?.getTime();
    if (t !== undefined && t >= bestAt) {
      bestAt = t;
      best = entry;
    }
  }
  return best;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * @param done true when the task sits in the lane the board marks as the finished one.
 */
export function deriveSignals(
  fields: TaskFields,
  log: LogEntry[],
  now: Date,
  done = false,
): DerivedSignals {
  const latest = newestEntry(log);
  const lastTouched =
    parseTime(latest?.at) ?? parseTime(fields.updated) ?? parseTime(fields.created) ?? now;
  const hoursSinceUpdate = Math.max(0, Math.floor((now.getTime() - lastTouched.getTime()) / HOUR));

  const derived: DerivedSignals = {
    momentum: momentumOf(log, hoursSinceUpdate, done),
    hoursSinceUpdate,
    overdue: false,
    attentionReasons: [],
  };

  const due = parseDueDate(fields.due);
  if (due) {
    derived.daysUntilDue = calendarDaysBetween(now, due);
    derived.overdue = derived.daysUntilDue < 0 && !done;
  }

  derived.attentionReasons = attentionReasons(derived, done);
  return derived;
}

function momentumOf(log: LogEntry[], hoursSinceUpdate: number, done: boolean): Momentum {
  if (done) return 'done';
  if (log.length === 0) return 'new';
  if (hoursSinceUpdate < MOVING_HOURS) return 'moving';
  if (hoursSinceUpdate < SLOWING_HOURS) return 'slowing';
  return 'stalled';
}

/**
 * Why a task wants attention, in plain words. Deliberately NOT a number: a score of 92
 * tells the user nothing, "Overdue by 2 days" tells them what to do. The ordering here is
 * the ranking — the first reason is the most urgent one.
 */
function attentionReasons(d: DerivedSignals, done: boolean): string[] {
  if (done) return [];
  const reasons: string[] = [];

  if (d.overdue && d.daysUntilDue !== undefined) {
    reasons.push(`Overdue by ${plural(-d.daysUntilDue, 'day')}`);
  } else if (d.daysUntilDue === 0) {
    reasons.push('Due today');
  } else if (d.daysUntilDue === 1) {
    reasons.push('Due tomorrow');
  }

  const days = Math.floor(d.hoursSinceUpdate / 24);
  if (days > STALE_ATTENTION_DAYS) reasons.push(`No update for ${plural(days, 'day')}`);

  return reasons;
}

/**
 * Ranking for the "needs attention" list. Only ever used to order rows — the number is
 * never shown to the user.
 */
export function attentionRank(d: DerivedSignals): number {
  if (d.attentionReasons.length === 0) return 0;
  let score = 1;
  if (d.overdue) score += 100 + Math.min(50, -(d.daysUntilDue ?? 0));
  else if (d.daysUntilDue === 0) score += 60;
  else if (d.daysUntilDue === 1) score += 40;
  score += Math.min(30, Math.floor(d.hoursSinceUpdate / 24) * 3);
  return score;
}
