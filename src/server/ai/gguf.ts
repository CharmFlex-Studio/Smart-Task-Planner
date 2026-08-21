/**
 * Reading a GGUF's own metadata, to find out what it can actually do.
 *
 * Tool calling is not a property of size. It is a property of the chat template the model
 * was trained and packaged with: llama-server runs that template (`--jinja`), and a
 * template with no place to put a tool call cannot produce one, whatever the parameter
 * count. Judging it by the number in the filename tells people a 4B Gemma and a 4B Qwen
 * are equally capable of driving tools, and one of them is not.
 *
 * So the answer comes from the file. Only the header is read — the KV block at the front,
 * not the tensors — so this costs a few milliseconds and no memory, and it stays true to
 * the rule that nothing about a model is written into this repository: the template is
 * whatever the file on disk says it is.
 */

import fs from 'node:fs/promises';

/** GGUF metadata value types, from the format spec. */
const enum Kind {
  Uint8 = 0, Int8 = 1, Uint16 = 2, Int16 = 3, Uint32 = 4, Int32 = 5,
  Float32 = 6, Bool = 7, String = 8, Array = 9, Uint64 = 10, Int64 = 11, Float64 = 12,
}
const FIXED_WIDTH: Record<number, number> = {
  0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8,
};

/**
 * How much of the file to read, growing only when the header turns out to be bigger.
 *
 * Most models keep everything we want inside the first megabyte. A big vocabulary pushes
 * it further — Gemma's 262k tokens put the chat template about 15MB in — but reading 32MB
 * for every model on every listing, to answer a question whose answer never changes, is a
 * lot of allocation and disk on a machine that may already be holding a model in memory.
 * So: start small, grow only if the walk runs out of data, and stop at a sane ceiling.
 */
const READ_STEPS = [256 * 1024, 4 * 1024 * 1024, 24 * 1024 * 1024] as const;

/**
 * Remembered per file, keyed on what would change if the file changed.
 *
 * The template inside a .gguf is fixed for the life of that file, and the listing is
 * rebuilt every time the settings page is opened. Reading it once is enough.
 */
const cache = new Map<string, { size: number; mtimeMs: number; info: GgufInfo | null }>();

export interface GgufInfo {
  architecture?: string;
  chatTemplate?: string;
}

/** Read the metadata block. Returns null for anything that is not a readable GGUF. */
export async function readGgufInfo(file: string): Promise<GgufInfo | null> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.info;

  const info = await readHeader(file, stat.size);
  cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, info });
  return info;
}

async function readHeader(file: string, fileSize: number): Promise<GgufInfo | null> {
  for (const step of READ_STEPS) {
    const want = Math.min(step, fileSize);
    const info = await readWindow(file, want);
    // `undefined` means the walk ran out of data — try a bigger window. `null` means the
    // file is not a GGUF at all, which a bigger window will not change.
    if (info !== undefined) return info;
    if (want >= fileSize) break;
  }
  return null;
}

/** null: not a GGUF. undefined: the window was too small. Otherwise: what was found. */
async function readWindow(file: string, size: number): Promise<GgufInfo | null | undefined> {
  let handle;
  try {
    handle = await fs.open(file, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buf, 0, size, 0);
    if (bytesRead < 24 || buf.toString('ascii', 0, 4) !== 'GGUF') return null;

    let at = 4;
    const u32 = () => {
      const v = buf.readUInt32LE(at);
      at += 4;
      return v;
    };
    const u64 = () => {
      const v = Number(buf.readBigUInt64LE(at));
      at += 8;
      return v;
    };
    const str = () => {
      const length = u64();
      // A length past what was read means the header is bigger than the window, or the
      // file is not what it claims. Either way, stop rather than read rubbish.
      if (length < 0 || at + length > bytesRead) throw new RangeError('past the header');
      const s = buf.toString('utf8', at, at + length);
      at += length;
      return s;
    };

    u32(); // version
    u64(); // tensor count
    const pairs = u64();

    const skip = (kind: number): void => {
      if (kind === Kind.String) {
        str();
        return;
      }
      if (kind === Kind.Array) {
        const inner = u32();
        const n = u64();
        for (let i = 0; i < n; i++) skip(inner);
        return;
      }
      at += FIXED_WIDTH[kind] ?? 4;
      if (at > bytesRead) throw new RangeError('past the header');
    };

    const info: GgufInfo = {};
    for (let i = 0; i < pairs; i++) {
      const key = str();
      const kind = u32();
      if (key === 'tokenizer.chat_template' && kind === Kind.String) {
        info.chatTemplate = str();
      } else if (key === 'general.architecture' && kind === Kind.String) {
        info.architecture = str();
      } else {
        skip(kind);
      }
      if (info.chatTemplate && info.architecture) break;
    }
    return info;
  } catch {
    // Ran out of window mid-walk. Not "no" — "ask again with more".
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * Whether the template has anywhere to put a tool call.
 *
 * A template that never mentions tools cannot emit one, and llama-server runs the model's
 * own template. `unknown` is its own answer and matters: a file we could not read is not
 * the same as a model that cannot do it, and saying "no" to both would be a guess wearing
 * the clothes of a measurement.
 */
export function toolSupportFromTemplate(template: string | undefined): 'yes' | 'no' | 'unknown' {
  if (template === undefined) return 'unknown';
  if (!template.trim()) return 'no';
  return /\btool_calls\b|\btools\b|\btool_call\b/.test(template) ? 'yes' : 'no';
}
