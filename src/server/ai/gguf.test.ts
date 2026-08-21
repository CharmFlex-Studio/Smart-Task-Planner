import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readGgufInfo, toolSupportFromTemplate } from './gguf.js';

/** Build a GGUF header with the given string metadata. Enough for the reader to walk. */
function ggufWith(pairs: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const str = (s: string) => { const v = Buffer.from(s, 'utf8'); return Buffer.concat([u64(v.length), v]); };

  parts.push(Buffer.from('GGUF', 'ascii'), u32(3), u64(0), u64(Object.keys(pairs).length));
  for (const [k, v] of Object.entries(pairs)) {
    parts.push(str(k), u32(8), str(v)); // 8 = STRING
  }
  return Buffer.concat(parts);
}

const withFile = async (bytes: Buffer, fn: (p: string) => Promise<void>) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gguf-'));
  const file = path.join(dir, 'model.gguf');
  await fs.writeFile(file, bytes);
  try {
    await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

describe('readGgufInfo', () => {
  it('pulls the template and architecture out of the header', async () => {
    await withFile(
      ggufWith({
        'general.architecture': 'qwen3',
        'tokenizer.chat_template': '{% if tools %}...{% endif %}',
      }),
      async (file) => {
        const info = await readGgufInfo(file);
        expect(info?.architecture).toBe('qwen3');
        expect(info?.chatTemplate).toContain('tools');
      },
    );
  });

  it('walks past metadata it does not care about', async () => {
    await withFile(
      ggufWith({
        'general.name': 'something',
        'general.license': 'apache-2.0',
        'tokenizer.chat_template': 'hello',
        'general.architecture': 'gemma3',
      }),
      async (file) => {
        const info = await readGgufInfo(file);
        expect(info?.chatTemplate).toBe('hello');
        expect(info?.architecture).toBe('gemma3');
      },
    );
  });

  it('is null for a file that is not a GGUF', async () => {
    await withFile(Buffer.from('this is not a model'), async (file) => {
      expect(await readGgufInfo(file)).toBeNull();
    });
  });

  it('is null for a file that is not there', async () => {
    expect(await readGgufInfo('/definitely/not/here.gguf')).toBeNull();
  });

  it('gives up rather than reading rubbish when the header is truncated', async () => {
    const full = ggufWith({ 'tokenizer.chat_template': 'x'.repeat(200) });
    await withFile(full.subarray(0, 40), async (file) => {
      // Either null or simply no template — never a garbage string.
      const info = await readGgufInfo(file);
      expect(info?.chatTemplate).toBeUndefined();
    });
  });
});

/**
 * The distinction this whole file exists for: tool calling is a property of the template,
 * not of the parameter count. A 4B model with tools in its template can drive them; a 4B
 * model without cannot, and telling someone otherwise sends them to download gigabytes of
 * something that will not do the job.
 */
describe('reading is proportionate and remembered', () => {
  it('grows the window when the header is bigger than the first read', async () => {
    // Padding before the template pushes it past the smallest step, so the reader has to
    // ask again with more — a big vocabulary does exactly this in a real model.
    const padding = 'x'.repeat(400 * 1024);
    await withFile(
      ggufWith({ 'general.name': padding, 'tokenizer.chat_template': '{% if tools %}ok' }),
      async (file) => {
        const info = await readGgufInfo(file);
        expect(info?.chatTemplate).toContain('tools');
      },
    );
  });

  it('does not read the file again when nothing about it changed', async () => {
    await withFile(ggufWith({ 'tokenizer.chat_template': 'first' }), async (file) => {
      expect((await readGgufInfo(file))?.chatTemplate).toBe('first');
      const t0 = process.hrtime.bigint();
      await readGgufInfo(file);
      const secondCall = Number(process.hrtime.bigint() - t0) / 1e6;
      // A cache hit is a stat, not a read: well under a millisecond.
      expect(secondCall).toBeLessThan(5);
    });
  });

  it('reads it again when the file has been replaced', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gguf-'));
    const file = path.join(dir, 'model.gguf');
    try {
      await fs.writeFile(file, ggufWith({ 'tokenizer.chat_template': 'first' }));
      expect((await readGgufInfo(file))?.chatTemplate).toBe('first');
      // A different size, which is what the cache is keyed on alongside mtime.
      await fs.writeFile(file, ggufWith({ 'tokenizer.chat_template': 'second version' }));
      expect((await readGgufInfo(file))?.chatTemplate).toBe('second version');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('toolSupportFromTemplate', () => {
  it('says yes when the template has somewhere to put a tool call', () => {
    expect(toolSupportFromTemplate('{% if tools %}{{ tools }}{% endif %}')).toBe('yes');
    expect(toolSupportFromTemplate('{%- for call in message.tool_calls %}')).toBe('yes');
  });

  it('says no for a template that never mentions them', () => {
    // The shape of a Gemma-style template: turns, and nothing else.
    expect(
      toolSupportFromTemplate('{{ bos_token }}{% for m in messages %}<start_of_turn>{{ m.role }}'),
    ).toBe('no');
  });

  it('says no for an empty template', () => {
    expect(toolSupportFromTemplate('')).toBe('no');
    expect(toolSupportFromTemplate('   ')).toBe('no');
  });

  it('says unknown when there was no template to read, which is not the same as no', () => {
    expect(toolSupportFromTemplate(undefined)).toBe('unknown');
  });

  it('is not fooled by the word appearing inside another', () => {
    expect(toolSupportFromTemplate('{{ toolbar }} {{ retooled }}')).toBe('no');
  });
});
