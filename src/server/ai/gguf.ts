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

/** Enough for the header of any model worth running; the tensors sit far past it. */
const HEADER_BYTES = 32 * 1024 * 1024;

export interface GgufInfo {
  architecture?: string;
  chatTemplate?: string;
}

/** Read the metadata block. Returns null for anything that is not a readable GGUF. */
export async function readGgufInfo(file: string): Promise<GgufInfo | null> {
  let handle;
  try {
    handle = await fs.open(file, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
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
    // A header we cannot walk tells us nothing, which is different from telling us "no".
    return null;
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
