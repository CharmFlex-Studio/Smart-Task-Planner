import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractArchive, readTar } from './archive.js';

const run = promisify(execFile);

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arch-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** Build a real .tar.gz with the system tar, so we are parsing the genuine format. */
async function makeTarGz(files: Record<string, string>, prefix = 'llama-b1'): Promise<string> {
  const src = path.join(dir, 'src', prefix);
  await fs.mkdir(src, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(src, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }
  const archive = path.join(dir, 'a.tar.gz');
  await run('tar', ['czf', archive, '-C', path.join(dir, 'src'), prefix]);
  return archive;
}

describe('readTar', () => {
  it('reads names and contents back exactly', async () => {
    const archive = await makeTarGz({ 'llama-server': 'BINARY', 'LICENSE': 'MIT' });
    const gz = await fs.readFile(archive);
    const { gunzipSync } = await import('node:zlib');
    const entries = readTar(new Uint8Array(gunzipSync(gz)));

    const byName = new Map(entries.map((e) => [e.name.split('/').pop(), e]));
    expect(new TextDecoder().decode(byName.get('llama-server')!.data)).toBe('BINARY');
    expect(new TextDecoder().decode(byName.get('LICENSE')!.data)).toBe('MIT');
  });

  it('handles a file whose size is not a multiple of the 512-byte block', async () => {
    // Tar pads every entry to 512 bytes. Getting that arithmetic wrong shifts every
    // subsequent header and corrupts the rest of the archive silently.
    const odd = 'x'.repeat(513);
    const archive = await makeTarGz({ first: odd, second: 'after-the-padding' });
    const { gunzipSync } = await import('node:zlib');
    const entries = readTar(new Uint8Array(gunzipSync(await fs.readFile(archive))));
    const byName = new Map(entries.map((e) => [e.name.split('/').pop(), e]));
    expect(byName.get('first')!.data.byteLength).toBe(513);
    expect(new TextDecoder().decode(byName.get('second')!.data)).toBe('after-the-padding');
  });

  it('skips directory entries', async () => {
    const archive = await makeTarGz({ 'sub/nested.txt': 'hi' });
    const { gunzipSync } = await import('node:zlib');
    const entries = readTar(new Uint8Array(gunzipSync(await fs.readFile(archive))));
    expect(entries.every((e) => !e.name.endsWith('/'))).toBe(true);
    expect(entries.some((e) => e.name.endsWith('nested.txt'))).toBe(true);
  });

  it('returns nothing for junk rather than looping forever', () => {
    expect(readTar(new Uint8Array(2048))).toEqual([]);
    expect(readTar(new Uint8Array(10))).toEqual([]);
  });
});

describe('extractArchive', () => {
  it('flattens a tar.gz and finds the binary regardless of its directory', async () => {
    const archive = await makeTarGz({
      'llama-server': '#!/bin/sh\n',
      'libggml.dylib': 'LIB',
      'LICENSE': 'MIT',
    });
    const out = path.join(dir, 'out');
    await extractArchive(archive, out, 'tar.gz');

    // Flattened: the binary and its sibling libraries land together, which is what the
    // dynamic loader needs.
    expect(await fs.readFile(path.join(out, 'llama-server'), 'utf8')).toBe('#!/bin/sh\n');
    expect(await fs.readFile(path.join(out, 'libggml.dylib'), 'utf8')).toBe('LIB');
  });

  it('marks the binary and shared libraries executable', async () => {
    const archive = await makeTarGz({ 'llama-server': 'x', 'libggml.dylib': 'y', 'LICENSE': 'z' });
    const out = path.join(dir, 'out');
    await extractArchive(archive, out, 'tar.gz');

    const mode = async (f: string) => (await fs.stat(path.join(out, f))).mode & 0o111;
    expect(await mode('llama-server')).not.toBe(0);
    expect(await mode('libggml.dylib')).not.toBe(0);
  });

  it('refuses an entry that would escape the target directory', async () => {
    // A hand-built tar with a traversing name; the system tar will not make one for us.
    const { gzipSync } = await import('node:zlib');
    const header = new Uint8Array(512);
    const name = '../../escaped.txt';
    header.set(new TextEncoder().encode(name), 0);
    header.set(new TextEncoder().encode('000644 \0'), 100);
    header.set(new TextEncoder().encode('00000000004 '), 124); // size = 4
    header[156] = '0'.charCodeAt(0);
    // checksum: sum of all bytes with the checksum field read as spaces
    header.set(new TextEncoder().encode('        '), 148);
    let sum = 0;
    for (const b of header) sum += b;
    header.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);

    const body = new Uint8Array(512);
    body.set(new TextEncoder().encode('evil'));
    const tar = new Uint8Array(512 * 4);
    tar.set(header, 0);
    tar.set(body, 512);

    const archive = path.join(dir, 'evil.tar.gz');
    await fs.writeFile(archive, gzipSync(Buffer.from(tar)));

    const out = path.join(dir, 'out');
    await extractArchive(archive, out, 'tar.gz');
    // Flattening to the basename is what makes this safe, and nothing lands outside.
    await expect(fs.access(path.join(dir, 'escaped.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, '..', 'escaped.txt'))).rejects.toThrow();
  });
});

describe('symlinks', () => {
  it('recreates versioned library symlinks, which the binary depends on', async () => {
    // Regression: these were silently skipped. The archive then looked complete and
    // llama-server died at startup with `Library not loaded: @rpath/libllama.0.dylib`.
    const src = path.join(dir, 'src', 'llama-b1');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'libllama.0.1.2.dylib'), 'REAL');
    await fs.symlink('libllama.0.1.2.dylib', path.join(src, 'libllama.0.dylib'));
    await fs.symlink('libllama.0.dylib', path.join(src, 'libllama.dylib'));
    await fs.writeFile(path.join(src, 'llama-server'), 'BIN');

    const archive = path.join(dir, 'links.tar.gz');
    await run('tar', ['czf', archive, '-C', path.join(dir, 'src'), 'llama-b1']);

    const out = path.join(dir, 'out');
    await extractArchive(archive, out, 'tar.gz');

    // Both the direct link and the chained one resolve to the real file.
    expect(await fs.readFile(path.join(out, 'libllama.0.dylib'), 'utf8')).toBe('REAL');
    expect(await fs.readFile(path.join(out, 'libllama.dylib'), 'utf8')).toBe('REAL');
    expect((await fs.lstat(path.join(out, 'libllama.0.dylib'))).isSymbolicLink()).toBe(true);
  });

  it('flattens a link target so it resolves inside the flattened directory', async () => {
    const src = path.join(dir, 'src', 'llama-b1');
    await fs.mkdir(path.join(src, 'lib'), { recursive: true });
    await fs.writeFile(path.join(src, 'lib', 'real.dylib'), 'X');
    await fs.symlink('lib/real.dylib', path.join(src, 'alias.dylib'));

    const archive = path.join(dir, 'nested.tar.gz');
    await run('tar', ['czf', archive, '-C', path.join(dir, 'src'), 'llama-b1']);
    const out = path.join(dir, 'out');
    await extractArchive(archive, out, 'tar.gz');

    expect(await fs.readFile(path.join(out, 'alias.dylib'), 'utf8')).toBe('X');
  });
});
