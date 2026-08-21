/**
 * Splitting and joining a due date that may or may not carry a time.
 *
 * `2026-08-25` and `2026-08-25T14:30` are both valid, and the difference is meaningful —
 * due *on* a day is not late until the day is over. So the time is only ever added when
 * someone actually sets one, never defaulted to midnight, which would quietly turn every
 * date into a deadline that expires the moment the day begins.
 */

export interface DueParts {
  date: string;
  /** Empty when the due date carries no time. */
  time: string;
}

export function splitDue(due: string | undefined): DueParts {
  if (!due) return { date: '', time: '' };
  const [date = '', time = ''] = due.replace(' ', 'T').split('T');
  return { date, time: time.slice(0, 5) };
}

/** Put the two halves back together, dropping the time when there is no date to hang it on. */
export function joinDue(date: string, time: string): string {
  if (!date) return '';
  return time ? `${date}T${time}` : date;
}

/** How a due date reads on screen: "25 Aug 2026", or "25 Aug 2026, 14:30". */
export function formatDue(due: string | undefined, locale?: string): string {
  const { date, time } = splitDue(due);
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(y!, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(at.getTime())) return due ?? '';
  const shown = at.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return time ? `${shown}, ${time}` : shown;
}
