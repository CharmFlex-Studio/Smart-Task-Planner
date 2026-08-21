import { describe, it, expect } from 'vitest';
import { splitDue, joinDue, formatDue } from './due.js';

describe('splitDue', () => {
  it('splits a date with a time', () => {
    expect(splitDue('2026-08-25T14:30')).toEqual({ date: '2026-08-25', time: '14:30' });
  });

  it('gives an empty time for a date on its own', () => {
    expect(splitDue('2026-08-25')).toEqual({ date: '2026-08-25', time: '' });
  });

  it('accepts a space instead of the T', () => {
    expect(splitDue('2026-08-25 09:05').time).toBe('09:05');
  });

  it('drops seconds, which the input cannot show anyway', () => {
    expect(splitDue('2026-08-25T14:30:59').time).toBe('14:30');
  });

  it('is empty for nothing at all', () => {
    expect(splitDue(undefined)).toEqual({ date: '', time: '' });
    expect(splitDue('')).toEqual({ date: '', time: '' });
  });
});

describe('joinDue', () => {
  it('keeps a date on its own when no time is set', () => {
    expect(joinDue('2026-08-25', '')).toBe('2026-08-25');
  });

  it('joins the two when there is a time', () => {
    expect(joinDue('2026-08-25', '14:30')).toBe('2026-08-25T14:30');
  });

  it('is empty without a date, so a stray time cannot survive alone', () => {
    expect(joinDue('', '14:30')).toBe('');
    expect(joinDue('', '')).toBe('');
  });
});

describe('formatDue', () => {
  it('shows a date without inventing a time', () => {
    expect(formatDue('2026-08-25', 'en-GB')).toBe('25 Aug 2026');
  });

  it('shows the time when there is one', () => {
    expect(formatDue('2026-08-25T14:30', 'en-GB')).toBe('25 Aug 2026, 14:30');
  });

  it('is empty for nothing', () => {
    expect(formatDue(undefined)).toBe('');
  });

  it('hands back anything it cannot read rather than showing "Invalid Date"', () => {
    expect(formatDue('whenever')).toBe('whenever');
  });
});
