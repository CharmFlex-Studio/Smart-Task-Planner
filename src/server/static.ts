/**
 * Serving the built frontend off disk.
 *
 * This exists because the obvious `serveStatic({ root })` resolves its root against
 * `process.cwd()`. That is fine when the server is started from the repo, and wrong the
 * moment the planner is installed globally and launched from whatever folder the user
 * happened to be in — on Windows a cwd on another drive cannot even be expressed as a
 * relative path. The package's own files are found from `import.meta.url`, never the cwd.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Find the built frontend.
 *
 * The compiled server lives at `dist/server/` and the sources at `src/server/`, so the
 * same `../../dist/web` happens to work for both — but relying on that coincidence means
 * a future move of either folder breaks the published package and not the dev server,
 * which is the worst way to find out. Ask for both, explicitly.
 */
export function findWebRoot(fromDir = path.dirname(fileURLToPath(import.meta.url))): string | null {
  const candidates = [
    path.resolve(fromDir, '../web'), // dist/server -> dist/web (published layout)
    path.resolve(fromDir, '../../dist/web'), // src/server -> dist/web (running from source)
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? null;
}

/**
 * Read one file out of `root`, refusing anything that escapes it.
 *
 * The request path is attacker-controlled in the only sense that matters here — a stray
 * `../` in a URL must not hand out a file from the user's home directory — so the resolved
 * path is checked to still be inside the root before anything is read.
 */
export async function readStaticFile(
  root: string,
  requestPath: string,
): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null; // Malformed percent-encoding is not a file.
  }
  if (decoded.includes('\0')) return null;

  const resolved = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(rootWithSep)) return null;

  try {
    // A plain Uint8Array over a plain ArrayBuffer, not the Buffer subclass: that is what
    // a Response body wants. Copied by length so the type is not `ArrayBufferLike`.
    const raw = await fs.promises.readFile(resolved);
    const body = new Uint8Array(raw.byteLength);
    body.set(raw);
    return { body, contentType: contentTypeFor(resolved) };
  } catch {
    return null;
  }
}
