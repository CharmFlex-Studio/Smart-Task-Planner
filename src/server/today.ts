/**
 * The "My work" view: what deserves attention, what to continue, what moved.
 *
 * Entirely deterministic — no model is consulted. The AI's job is to *explain* this
 * grouping later, never to produce it. Keeping the objective signals out of the model is
 * what makes this screen instant, correct offline, and identical every time you load it.
 *
 * It knows nothing about which lane means what, beyond the one the board marks as done.
 */

import type { LogEntry, Task } from '@shared/types.js';
import { attentionRank } from './vault/derive.js';

export interface RecentActivity {
  task: Pick<Task['fields'], 'id' | 'title'>;
  entry: LogEntry;
}

export interface TodayView {
  date: string;
  needsAttention: Task[];
  continueWith: Task[];
  recent: RecentActivity[];
  counts: {
    open: number;
    done: number;
    updatedToday: number;
    stale: number;
  };
}

const DAY_MS = 86_400_000;
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function buildToday(tasks: Task[], now = new Date(), recentLimit = 12): TodayView {
  const live = tasks.filter((t) => !t.archived);
  const open = live.filter((t) => t.derived.momentum !== 'done');
  const today = isoDate(now);

  const needsAttention = open
    .filter((t) => t.derived.attentionReasons.length > 0)
    .sort((a, b) => attentionRank(b.derived) - attentionRank(a.derived));

  const flagged = new Set(needsAttention.map((t) => t.fields.id));

  const continueWith = open
    .filter((t) => !flagged.has(t.fields.id))
    .sort((a, b) => a.derived.hoursSinceUpdate - b.derived.hoursSinceUpdate);

  const recent: RecentActivity[] = [];
  for (const task of live) {
    for (const entry of task.log) {
      const at = new Date(entry.at).getTime();
      if (!Number.isNaN(at) && now.getTime() - at <= 2 * DAY_MS) {
        recent.push({ task: { id: task.fields.id, title: task.fields.title }, entry });
      }
    }
  }
  recent.sort((a, b) => new Date(b.entry.at).getTime() - new Date(a.entry.at).getTime());

  return {
    date: today,
    needsAttention,
    continueWith,
    recent: recent.slice(0, recentLimit),
    counts: {
      open: open.length,
      done: tasks.filter((t) => t.derived.momentum === 'done' && t.derived.hoursSinceUpdate <= 168)
        .length,
      updatedToday: live.filter((t) => t.log.some((e) => e.at.startsWith(today))).length,
      stale: open.filter((t) => t.derived.momentum === 'stalled').length,
    },
  };
}
