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
