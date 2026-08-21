import { describe, it, expect } from 'vitest';
import { blockPadding } from './attach.js';

const pad = (doc: string, at: number) => {
  const { before, after } = blockPadding(doc, at);
  return doc.slice(0, at) + before + '<IMG>' + after + doc.slice(at);
};

describe('blockPadding', () => {
  it('adds nothing in an empty document', () => {
    expect(blockPadding('', 0)).toEqual({ before: '', after: '' });
  });

  it('breaks out of the end of a sentence', () => {
    expect(pad('Drop a file below.', 18)).toBe('Drop a file below.\n\n<IMG>');
  });

  it('leaves a blank line that is already there alone', () => {
    expect(pad('Above.\n\n', 8)).toBe('Above.\n\n<IMG>');
  });

  it('completes a single newline into a paragraph break', () => {
    expect(pad('Above.\n', 7)).toBe('Above.\n\n<IMG>');
  });

  it('separates from what follows as well', () => {
    expect(pad('Above.\n\nBelow.', 8)).toBe('Above.\n\n<IMG>\n\nBelow.');
  });

  it('does not pad the start of the document', () => {
    expect(blockPadding('Below.', 0).before).toBe('');
  });

  it('does not pad the end of the document', () => {
    expect(blockPadding('Above.', 6).after).toBe('');
  });

  it('handles a cursor in the middle of a line', () => {
    expect(pad('one two', 3)).toBe('one\n\n<IMG>\n\n two');
  });
});
