import { describe, it, expect } from 'vitest';
import { deriveSignals } from './derive.js';
import type { LogEntry, TaskFields } from '@shared/types.js';

const NOW = new Date('2026-08-20T12:00:00');

function fields(over: Partial<TaskFields> = {}): TaskFields {
  return {
    id: 'x',
    title: 'T',
    status: 'in-progress',
    created: '2026-08-01T09:00:00',
    updated: '2026-08-20T09:00:00',
    ...over,
  };
}
const log = (...entries: [string, LogEntry['type'], string][]): LogEntry[] =>
  entries.map(([at, type, text]) => ({ at, type, text }));

describe('momentum', () => {
  it('is new when there is no log at all', () => {
    expect(deriveSignals(fields(), [], NOW).momentum).toBe('new');
  });
  it('is done when the task sits in the board\'s done lane, whatever the log says', () => {
    expect(deriveSignals(fields({ status: 'done' }), [], NOW, true).momentum).toBe('done');
  });
  it('is not done just because the lane is called done, if the board does not say so', () => {
    expect(deriveSignals(fields({ status: 'done' }), [], NOW, false).momentum).toBe('new');
  });
  it('is moving just inside 24h and slowing just outside it', () => {
    expect(deriveSignals(fields(), log(['2026-08-19T12:30', 'progress', 'x']), NOW).momentum).toBe('moving');
    expect(deriveSignals(fields(), log(['2026-08-19T11:30', 'progress', 'x']), NOW).momentum).toBe('slowing');
  });
  it('is slowing just inside 72h and stalled just outside it', () => {
    expect(deriveSignals(fields(), log(['2026-08-17T12:30', 'progress', 'x']), NOW).momentum).toBe('slowing');
    expect(deriveSignals(fields(), log(['2026-08-17T11:30', 'progress', 'x']), NOW).momentum).toBe('stalled');
  });
  it('uses the newest entry even when the log is out of order', () => {
    const d = deriveSignals(fields(), log(
      ['2026-08-20T11:00', 'progress', 'newest'],
      ['2026-08-01T09:00', 'note', 'oldest'],
    ), NOW);
    expect(d.momentum).toBe('moving');
    expect(d.hoursSinceUpdate).toBe(1);
  });
});

describe('due dates use local calendar days, not UTC instants', () => {
  it('counts today as 0 and tomorrow as 1', () => {
    expect(deriveSignals(fields({ due: '2026-08-20' }), [], NOW).daysUntilDue).toBe(0);
    expect(deriveSignals(fields({ due: '2026-08-21' }), [], NOW).daysUntilDue).toBe(1);
    expect(deriveSignals(fields({ due: '2026-08-19' }), [], NOW).daysUntilDue).toBe(-1);
  });
  it('is not overdue on the due day itself', () => {
    expect(deriveSignals(fields({ due: '2026-08-20' }), [], NOW).overdue).toBe(false);
    expect(deriveSignals(fields({ due: '2026-08-19' }), [], NOW).overdue).toBe(true);
  });
  it('is never overdue once done', () => {
    expect(deriveSignals(fields({ due: '2020-01-01' }), [], NOW, true).overdue).toBe(false);
  });
  it('ignores an unparseable due date instead of throwing', () => {
    const d = deriveSignals(fields({ due: 'next tuesday' }), [], NOW);
    expect(d.daysUntilDue).toBeUndefined();
    expect(d.overdue).toBe(false);
  });
});

describe('attention reasons', () => {
  it('are empty for a healthy, recently touched task', () => {
    const d = deriveSignals(fields(), log(['2026-08-20T11:00', 'progress', 'x']), NOW);
    expect(d.attentionReasons).toEqual([]);
  });
  it('report overdue first', () => {
    const d = deriveSignals(fields({ due: '2026-08-18' }), log(['2026-08-20T11:00', 'progress', 'x']), NOW);
    expect(d.attentionReasons[0]).toMatch(/overdue/i);
  });
  it('report a due date within a day', () => {
    const d = deriveSignals(fields({ due: '2026-08-21' }), log(['2026-08-20T11:00', 'progress', 'x']), NOW);
    expect(d.attentionReasons.join(' ')).toMatch(/due tomorrow/i);
  });
  it('report staleness only past three days', () => {
    expect(deriveSignals(fields(), log(['2026-08-18T11:00', 'progress', 'x']), NOW).attentionReasons).toEqual([]);
    expect(deriveSignals(fields(), log(['2026-08-16T11:00', 'progress', 'x']), NOW).attentionReasons.join(' '))
      .toMatch(/no update for 4 days/i);
  });
  it('never nag about a done task', () => {
    const d = deriveSignals(fields({ status: 'done', due: '2020-01-01' }), [], NOW, true);
    expect(d.attentionReasons).toEqual([]);
  });
});

/**
 * A due date with a time means something different from one without: due *on* a day is
 * not late until the day is over, due *at* 14:00 is late at 14:01. Both sides of every
 * boundary, because getting one of them wrong makes half the tasks in a board lie.
 */
describe('a due date with a time', () => {
  // NOW is 2026-08-20T12:00.
  const at = (due: string) => deriveSignals(fields({ due }), [], NOW);

  it('is not overdue a minute before, and is a minute after', () => {
    expect(at('2026-08-20T12:01').overdue).toBe(false);
    expect(at('2026-08-20T11:59').overdue).toBe(true);
  });

  it('is overdue later the same day, which a date alone could not express', () => {
    expect(at('2026-08-20T09:00').overdue).toBe(true);
    expect(at('2026-08-20').overdue).toBe(false); // same day, no time: not late yet
  });

  it('counts the lateness in hours while it is still inside a day', () => {
    expect(at('2026-08-20T09:00').attentionReasons[0]).toBe('Overdue by 3 hours');
    expect(at('2026-08-20T11:00').attentionReasons[0]).toBe('Overdue by 1 hour');
  });

  it('goes back to days once it is more than a day late', () => {
    expect(at('2026-08-18T09:00').attentionReasons[0]).toBe('Overdue by 2 days');
  });

  it('says how long is left when it is due later today', () => {
    expect(at('2026-08-20T15:00').attentionReasons[0]).toBe('Due in 3 hours');
  });

  it('still says "Due today" for a date with no time', () => {
    expect(at('2026-08-20').attentionReasons[0]).toBe('Due today');
  });

  it('reports whether the time was there, so the UI can show one', () => {
    expect(at('2026-08-20T15:00').dueHasTime).toBe(true);
    expect(at('2026-08-20').dueHasTime).toBe(false);
  });

  it('is never overdue once the task is done', () => {
    expect(deriveSignals(fields({ due: '2026-08-19T09:00' }), [], NOW, true).overdue).toBe(false);
  });

  it('still counts calendar days, so "Due tomorrow" survives a time', () => {
    expect(at('2026-08-21T09:00').attentionReasons[0]).toBe('Due tomorrow');
  });
});
