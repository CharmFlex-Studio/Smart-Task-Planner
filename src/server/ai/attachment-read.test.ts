import { describe, it, expect } from 'vitest';
import {
  classifyAttachment,
  decodeText,
  clampText,
  describeSize,
  MAX_TEXT_CHARS,
} from './attachment-read.js';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('classifyAttachment', () => {
  it('reads the things a person would open in an editor', () => {
    expect(classifyAttachment('notes.md')).toEqual({ kind: 'text' });
    expect(classifyAttachment('data.csv')).toEqual({ kind: 'text' });
    expect(classifyAttachment('server.log')).toEqual({ kind: 'text' });
    expect(classifyAttachment('main.ts')).toEqual({ kind: 'text' });
  });

  it('recognises the images a model could be shown', () => {
    expect(classifyAttachment('shot.png')).toEqual({ kind: 'image', mediaType: 'image/png' });
    expect(classifyAttachment('PHOTO.JPG')).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
  });

  it('treats svg as text, which is what it is', () => {
    // Never rendered here — read as source, where it is just markup.
    expect(classifyAttachment('logo.svg')).toEqual({ kind: 'text' });
  });

  it('refuses everything else rather than guessing', () => {
    expect(classifyAttachment('report.pdf')).toEqual({ kind: 'other' });
    expect(classifyAttachment('archive.zip')).toEqual({ kind: 'other' });
    expect(classifyAttachment('no-extension')).toEqual({ kind: 'other' });
  });
});

/**
 * An extension is a claim, not a fact. Decoding a binary file that happens to be called
 * .csv produces nonsense the model would then try to reason about.
 */
describe('decodeText', () => {
  it('decodes real text', () => {
    expect(decodeText(bytes('hello, world'))).toBe('hello, world');
  });

  it('keeps text that is legitimately not ASCII', () => {
    expect(decodeText(bytes('café — naïve — 日本語'))).toBe('café — naïve — 日本語');
  });

  it('refuses something with a NUL byte in it, whatever it is called', () => {
    expect(decodeText(new Uint8Array([0x68, 0x69, 0x00, 0x68, 0x69]))).toBeNull();
  });

  it('refuses bytes that are not really UTF-8', () => {
    const junk = new Uint8Array(400).fill(0xc3);
    expect(decodeText(junk)).toBeNull();
  });

  it('is fine with an empty file', () => {
    expect(decodeText(new Uint8Array(0))).toBe('');
  });
});

describe('clampText', () => {
  it('leaves a short file whole', () => {
    expect(clampText('short', 'a.txt')).toBe('short');
  });

  it('cuts a long one and says that it did', () => {
    const long = 'x'.repeat(MAX_TEXT_CHARS + 500);
    const out = clampText(long, 'big.log');
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain('big.log continues for 500 more characters');
  });

  it('respects a budget given to it', () => {
    expect(clampText('abcdef', 'a.txt', 3).startsWith('abc')).toBe(true);
  });
});

describe('describeSize', () => {
  it('reads the way a person would say it', () => {
    expect(describeSize(512)).toBe('512 B');
    expect(describeSize(2048)).toBe('2 KB');
    expect(describeSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
