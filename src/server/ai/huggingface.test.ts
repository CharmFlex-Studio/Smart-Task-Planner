import { describe, it, expect } from 'vitest';
import {
  downloadUrl,
  isValidGgufFile,
  isValidRepoId,
  parseQuant,
  toolCallingForSize,
} from './huggingface.js';

/**
 * Only the pure parts. The network calls are exercised by hand against the real API —
 * mocking Hugging Face here would test the mock, and the whole point of this module is
 * that it does not rely on anything remembered at build time.
 */

describe('repo and file validation', () => {
  it('accepts ordinary repo ids', () => {
    for (const repo of [
      'unsloth/Qwen3.5-4B-GGUF',
      'google/gemma-4-E4B-it-qat-q4_0-gguf',
      'bartowski/Qwen_Qwen2.5-7B-Instruct-GGUF',
    ]) {
      expect(isValidRepoId(repo)).toBe(true);
    }
  });

  it('refuses anything that could climb out of a url path', () => {
    for (const bad of [
      '../../etc/passwd',
      'owner/name/../..',
      'owner',
      '/owner/name',
      'owner//name',
      'owner/name?x=1',
      'owner/name#frag',
      'https://evil.test/a/b',
      '',
    ]) {
      expect(isValidRepoId(bad)).toBe(false);
    }
  });

  it('only accepts .gguf filenames', () => {
    expect(isValidGgufFile('Qwen3.5-4B-Q4_K_M.gguf')).toBe(true);
    expect(isValidGgufFile('model.bin')).toBe(false);
    expect(isValidGgufFile('../escape.gguf')).toBe(false);
    expect(isValidGgufFile('.hidden.gguf')).toBe(false);
  });
});

describe('downloadUrl', () => {
  it('builds a resolve url for a file', () => {
    expect(downloadUrl('unsloth/Qwen3.5-4B-GGUF', 'Qwen3.5-4B-Q4_K_M.gguf')).toBe(
      'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf?download=true',
    );
  });

  it('handles a file nested in a subdirectory', () => {
    expect(downloadUrl('owner/repo', 'Q4_K_M/model-Q4_K_M.gguf')).toBe(
      'https://huggingface.co/owner/repo/resolve/main/Q4_K_M/model-Q4_K_M.gguf?download=true',
    );
  });

  it('throws rather than building a url from a hostile repo id', () => {
    expect(() => downloadUrl('../../etc', 'x.gguf')).toThrow();
    expect(() => downloadUrl('owner/repo', '../../secret.gguf')).toThrow();
    expect(() => downloadUrl('owner/repo', 'model.bin')).toThrow();
  });
});

describe('parseQuant', () => {
  it('reads the quantization out of real filenames', () => {
    expect(parseQuant('Qwen3.5-4B-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(parseQuant('Qwen3.5-4B-IQ4_XS.gguf')).toBe('IQ4_XS');
    expect(parseQuant('Qwen3.5-4B-BF16.gguf')).toBe('BF16');
    expect(parseQuant('Qwen3.5-4B-Q8_0.gguf')).toBe('Q8_0');
  });

  it('strips the unsloth dynamic-quant prefix so it groups with its family', () => {
    expect(parseQuant('Qwen3.5-4B-UD-Q4_K_XL.gguf')).toBe('Q4_K_XL');
  });

  it('says unknown rather than guessing', () => {
    expect(parseQuant('model.gguf')).toBe('unknown');
  });
});

describe('tool-calling rule of thumb', () => {
  it('treats sub-3B as unreliable for driving tools', () => {
    expect(toolCallingForSize('unsloth/Qwen3.5-2B-GGUF').level).toBe('unreliable');
    expect(toolCallingForSize('llama-3.2-1b-instruct').level).toBe('unreliable');
  });

  it('treats 3B-7B as workable', () => {
    expect(toolCallingForSize('unsloth/Qwen3.5-4B-GGUF').level).toBe('workable');
    expect(toolCallingForSize('qwen2.5:3b').level).toBe('workable');
  });

  it('treats 7B and up as reliable', () => {
    expect(toolCallingForSize('unsloth/Qwen3.5-9B-GGUF').level).toBe('reliable');
    expect(toolCallingForSize('gemma-4-12B-it').level).toBe('reliable');
  });

  it('judges a mixture-of-experts model by its ACTIVE parameters', () => {
    // 35B total but only 3B active per token, so it behaves like a small model here.
    expect(toolCallingForSize('Qwen/Qwen3.5-35B-A3B').params).toBe(3);
    expect(toolCallingForSize('Qwen/Qwen3.5-35B-A3B').level).toBe('workable');
    expect(toolCallingForSize('google/gemma-4-26B-A4B-it').params).toBe(4);
  });

  it("understands Gemma's effective-parameter naming", () => {
    // E4B means it is served like a 4B, whatever the total parameter count.
    expect(toolCallingForSize('unsloth/gemma-4-E4B-it-GGUF').params).toBe(4);
    expect(toolCallingForSize('unsloth/gemma-4-E4B-it-GGUF').level).toBe('workable');
    expect(toolCallingForSize('gemma4:e2b').level).toBe('unreliable');
  });

  it('admits it does not know when the name carries no parameter count', () => {
    expect(toolCallingForSize('someone/mystery-model-GGUF').level).toBe('unknown');
  });
});
