import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';

/**
 * Unpacking a downloaded runtime.
 *
 * llama.cpp publishes `.zip` for Windows and `.tar.gz` for macOS and Linux, so both are
 * needed. Gzip is in Node's standard library; tar is not, but the format is a sequence of
 * 512-byte headers each followed by its file data padded to the next 512-byte boundary,
 * which is about forty lines to read and not worth a dependency.
 *
 * Both formats are **flattened** to basenames on extraction. That is deliberate twice
 * over: the archives nest everything under a `llama-<build>/` directory that would
 * otherwise have to be guessed at (and has moved between releases), and flattening means
 * an entry named `../../etc/something` can never write outside the target directory.
 */

const BLOCK = 512;

export interface TarEntry {
  name: string;
  data: Uint8Array;
  /** Unix mode from the header, when it parses. */
  mode: number;
  /**
   * Target of a symbolic link, for entries that are links rather than files.
   *
   * These are not decoration. llama.cpp's macOS and Linux archives use the usual
   * versioned-library convention -- `libllama.0.dylib` is a symlink to
   * `libllama.0.1.2.dylib` -- and the binary's load commands reference the unversioned
   * name. Skipping link entries produces a directory that looks complete and a
   * `llama-server` that dies at startup with `Library not loaded: @rpath/...`.
   */
  linkTo?: string;
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end)).trim();
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  const text = readString(bytes, offset, length).replace(/[^0-7]/g, '');
  return text ? parseInt(text, 8) : 0;
}

/** Read a (already decompressed) tar archive. Returns file entries only. */
export function readTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + BLOCK);

    // Two consecutive zero blocks end the archive; a single one means junk, and either
    // way there is nothing more to read.
    if (header.every((b) => b === 0)) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const mode = readOctal(header, 100, 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const linkName = readString(header, 157, 100);
    // `prefix` (155 bytes at 345) holds long paths in the USTAR format.
    const prefix = readString(header, 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;

    offset += BLOCK;
    if (!name) break;

    // '0' and '\0' are regular files, '2' is a symlink, '5' is a directory. Anything else
    // (hard links, pax extended headers) we step over without extracting.
    if ((type === '0' || type === '\0') && size > 0) {
      const data = bytes.subarray(offset, offset + size);
      if (data.byteLength === size) entries.push({ name: full, data, mode });
    } else if (type === '2' && linkName) {
      entries.push({ name: full, data: new Uint8Array(0), mode, linkTo: linkName });
    }

    // Every entry's data is padded up to the next block boundary.
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}

/** True for a file that needs the execute bit: a bare binary, or a shared library. */
function needsExecuteBit(base: string, mode: number): boolean {
  if ((mode & 0o111) !== 0) return true;
  if (/\.(so|dylib|dll|exe)($|\.)/i.test(base)) return true;
  return !base.includes('.');
}

/**
 * Extract an archive into `intoDir`, flattening to basenames.
 *
 * Flattening is what puts `llama-server` beside the `libggml*.dylib` files it loads at
 * runtime, which is what the dynamic loader expects.
 */
export async function extractArchive(
  archivePath: string,
  intoDir: string,
  kind: 'zip' | 'tar.gz',
): Promise<string[]> {
  const raw = await fs.readFile(archivePath);
  await fs.mkdir(intoDir, { recursive: true });

  const files: TarEntry[] = [];

  if (kind === 'zip') {
    const unzipped = unzipSync(new Uint8Array(raw));
    for (const [name, data] of Object.entries(unzipped)) {
      if (!name.endsWith('/') && data.byteLength > 0) files.push({ name, data, mode: 0 });
    }
  } else {
    files.push(...readTar(new Uint8Array(gunzipSync(raw))));
  }

  const safeBase = (name: string): string | null => {
    const base = path.basename(name);
    // basename() alone defeats `../` traversal, but be explicit about it.
    return !base || base === '.' || base === '..' || base.startsWith('.') ? null : base;
  };

  const written: string[] = [];

  // Regular files first, so a link always has something to point at.
  for (const entry of files) {
    if (entry.linkTo) continue;
    const base = safeBase(entry.name);
    if (!base) continue;
    const target = path.join(intoDir, base);
    await fs.writeFile(target, entry.data);
    if (needsExecuteBit(base, entry.mode)) await fs.chmod(target, 0o755).catch(() => {});
    written.push(target);
  }

  // Then the links. Targets are flattened to basenames too, so a relative link inside the
  // archive still resolves inside the flattened directory.
  for (const entry of files) {
    if (!entry.linkTo) continue;
    const base = safeBase(entry.name);
    const to = safeBase(entry.linkTo);
    if (!base || !to || base === to) continue;

    const link = path.join(intoDir, base);
    await fs.rm(link, { force: true });
    try {
      await fs.symlink(to, link);
    } catch {
      // Windows refuses symlinks without a privilege; a copy is equivalent here and the
      // libraries involved are small.
      await fs.copyFile(path.join(intoDir, to), link).catch(() => {});
    }
    written.push(link);
  }

  return written;
}
