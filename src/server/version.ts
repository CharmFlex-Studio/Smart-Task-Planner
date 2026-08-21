/**
 * What version of watsmytask this is.
 *
 * Read once from the package.json we were installed as, and surfaced in the UI, because
 * without it there is no way to tell a stale install from a broken feature — the two look
 * identical from the screen, and the installers pin a version deliberately, so running an
 * old copy is a normal thing to be doing rather than a mistake.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function read(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server/version.js and src/server/version.ts are both two below the package root.
  try {
    const raw = fs.readFileSync(path.resolve(here, '../../package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const VERSION = read();
