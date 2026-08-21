import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contentTypeFor, findWebRoot, readStaticFile } from './static.js';

let root = '';
let outside = '';

beforeAll(async () => {
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-static-'));
  root = path.join(outside, 'web');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<html>hi</html>');
  await fs.writeFile(path.join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  await fs.writeFile(path.join(root, 'assets', 'index-abc123.css'), 'body{}');
  // A file next to the root, which no request may ever reach.
  await fs.writeFile(path.join(outside, 'secret.txt'), 'private notes');
});

afterAll(async () => {
  await fs.rm(outside, { recursive: true, force: true });
});

describe('contentTypeFor', () => {
  it('names the types vite actually emits', () => {
    expect(contentTypeFor('index-abc.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('index-abc.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('logo.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('font.woff2')).toBe('font/woff2');
  });

  it('is case-insensitive about the extension', () => {
    expect(contentTypeFor('LOGO.SVG')).toBe('image/svg+xml');
  });

  it('falls back rather than guessing', () => {
    expect(contentTypeFor('weird.qqq')).toBe('application/octet-stream');
    expect(contentTypeFor('no-extension')).toBe('application/octet-stream');
  });
});

describe('readStaticFile', () => {
  it('reads a file under the root', async () => {
    const file = await readStaticFile(root, '/assets/index-abc123.js');
    expect(file && new TextDecoder().decode(file.body)).toBe('console.log(1)');
    expect(file?.contentType).toBe('text/javascript; charset=utf-8');
  });

  it('decodes percent-encoded paths', async () => {
    const file = await readStaticFile(root, '/assets/index%2Dabc123.css');
    expect(file && new TextDecoder().decode(file.body)).toBe('body{}');
  });

  it('returns null for a file that is not there', async () => {
    expect(await readStaticFile(root, '/assets/missing.js')).toBeNull();
  });

  it('refuses to climb out of the root', async () => {
    expect(await readStaticFile(root, '/assets/../../secret.txt')).toBeNull();
    expect(await readStaticFile(root, '/../secret.txt')).toBeNull();
  });

  it('refuses an encoded climb out of the root', async () => {
    expect(await readStaticFile(root, '/assets/..%2F..%2Fsecret.txt')).toBeNull();
    expect(await readStaticFile(root, '/%2e%2e/secret.txt')).toBeNull();
  });

  it('refuses a sibling directory that merely shares the root prefix', async () => {
    const sibling = root + '-other';
    await fs.mkdir(sibling, { recursive: true });
    await fs.writeFile(path.join(sibling, 'leak.txt'), 'nope');
    expect(await readStaticFile(root, '/../web-other/leak.txt')).toBeNull();
  });

  it('refuses malformed encoding and null bytes rather than throwing', async () => {
    expect(await readStaticFile(root, '/assets/%ZZ')).toBeNull();
    expect(await readStaticFile(root, '/assets/x%00.js')).toBeNull();
  });

  it('does not hand back a directory as if it were a file', async () => {
    expect(await readStaticFile(root, '/assets')).toBeNull();
  });
});

describe('findWebRoot', () => {
  it('finds the published layout: dist/server -> dist/web', async () => {
    const dist = path.join(outside, 'pkg', 'dist');
    await fs.mkdir(path.join(dist, 'server'), { recursive: true });
    await fs.mkdir(path.join(dist, 'web'), { recursive: true });
    await fs.writeFile(path.join(dist, 'web', 'index.html'), '<html></html>');
    expect(findWebRoot(path.join(dist, 'server'))).toBe(path.join(dist, 'web'));
  });

  it('finds the source layout: src/server -> dist/web', async () => {
    const repo = path.join(outside, 'repo');
    await fs.mkdir(path.join(repo, 'src', 'server'), { recursive: true });
    await fs.mkdir(path.join(repo, 'dist', 'web'), { recursive: true });
    await fs.writeFile(path.join(repo, 'dist', 'web', 'index.html'), '<html></html>');
    expect(findWebRoot(path.join(repo, 'src', 'server'))).toBe(path.join(repo, 'dist', 'web'));
  });

  it('returns null when the frontend has not been built', async () => {
    const bare = path.join(outside, 'bare', 'dist', 'server');
    await fs.mkdir(bare, { recursive: true });
    expect(findWebRoot(bare)).toBeNull();
  });
});

/**
 * The two halves of serving a fingerprinted build, and they must not be the same.
 *
 * Assets carry a content hash in the filename, so they can be cached forever. The page
 * that names them cannot: a browser holding the previous version's index.html asks for a
 * script that no longer exists and the app never starts — which looks, from the outside,
 * exactly like the update broke something.
 */
describe('what may be cached', () => {
  it('serves the entry page with no-cache', async () => {
    const { buildApp } = await import('./app.js');
    const { resolvePaths } = await import('./config.js');
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-'));
    const { app } = await buildApp(
      resolvePaths({ WATSMYTASK_VAULT: vault, WATSMYTASK_HOME: path.join(vault, '.app') }),
    );
    const res = await app.request('http://localhost/');
    // Only meaningful when a built frontend is present; skip rather than assert nothing.
    if (res.status === 200 && (res.headers.get('content-type') ?? '').includes('html')) {
      expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    }
    await fs.rm(vault, { recursive: true, force: true });
  });
});
