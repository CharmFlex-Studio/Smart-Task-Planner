import { createTwoFilesPatch } from 'diff';
import type { FileDiff } from '@shared/types.js';

/**
 * A unified diff of a proposed change.
 *
 * Every write in the system produces one of these *before* anything touches the disk. It
 * is what the chat's confirmation UI renders, and it is why an unreliable model is merely
 * annoying rather than dangerous: the worst a bad tool call can do is show you a diff you
 * decline.
 */
export function buildDiff(path: string, before: string, after: string): FileDiff {
  if (before === after) return { path, patch: '', created: false };
  const created = before.length === 0;
  const patch = createTwoFilesPatch(
    created ? '/dev/null' : path,
    path,
    before,
    after,
    undefined,
    undefined,
    { context: 3 },
  );
  return { path, patch, created };
}

/** A compact "+3 −1" style summary, for places too small to render a full patch. */
export function diffStat(diff: FileDiff): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}
