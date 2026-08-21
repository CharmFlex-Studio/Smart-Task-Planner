import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { previewRanges, activeLines } from './live-preview.js';

/** Build a state, putting the cursor at `at` (default: the very start). */
const state = (doc: string, at = 0) =>
  EditorState.create({
    doc,
    selection: { anchor: at },
    extensions: [markdown({ base: markdownLanguage })],
  });

/** What the reader ends up seeing: the doc with every hidden range removed. */
function visible(doc: string, at = 0): string {
  const s = state(doc, at);
  const hidden = previewRanges(s).filter((r) => r.kind === 'hide');
  let out = '';
  let pos = 0;
  for (const r of hidden.sort((a, b) => a.from - b.from)) {
    if (r.from < pos) continue; // overlapping hides; the first one wins
    out += doc.slice(pos, r.from);
    pos = r.to;
  }
  return out + doc.slice(pos);
}

const kinds = (doc: string, at = 0) =>
  previewRanges(state(doc, at))
    .filter((r) => r.kind !== 'hide')
    .map((r) => `${r.kind}:${doc.slice(r.from, r.to)}`);

describe('the syntax disappears', () => {
  it('hides emphasis markers and styles what they wrapped', () => {
    // Cursor on line 1; put the text on line 3 so it is not the active line.
    expect(visible('\n\nsome **bold** here')).toBe('\n\nsome bold here');
    expect(kinds('\n\nsome **bold** here')).toContain('strong:**bold**');
  });

  it('hides italic, strikethrough and code markers', () => {
    expect(visible('\n\n*it* ~~no~~ `c`')).toBe('\n\nit no c');
  });

  it('hides a heading marker and the space after it', () => {
    expect(visible('\n\n## Section')).toBe('\n\nSection');
    expect(kinds('\n\n## Section')).toContain('heading:## Section');
  });

  it('hides a quote marker', () => {
    expect(visible('\n\n> quoted')).toBe('\n\nquoted');
  });

  it('keeps a link label and hides its brackets and target', () => {
    expect(visible('\n\nsee [the docs](https://example.com) now')).toBe('\n\nsee the docs now');
  });

  it('leaves plain prose completely alone', () => {
    expect(visible('\n\njust a sentence')).toBe('\n\njust a sentence');
    expect(previewRanges(state('\n\njust a sentence'))).toHaveLength(0);
  });

  it('does not touch the text inside a fenced code block', () => {
    const doc = '\n\n```ts\nconst x = **1**;\n```';
    expect(visible(doc)).toContain('const x = **1**;');
  });
});

/**
 * The half that makes it usable rather than merely pretty: you have to be able to get at
 * the characters causing an effect, or fixing a stray asterisk is guesswork.
 */
describe('the syntax comes back on the line the cursor is on', () => {
  const doc = 'line one\n**bold on line two**\nline three';
  const lineTwoStart = doc.indexOf('**bold');

  it('is hidden while the cursor is elsewhere', () => {
    expect(visible(doc, 0)).toBe('line one\nbold on line two\nline three');
  });

  it('is shown when the cursor is on that line', () => {
    expect(visible(doc, lineTwoStart + 4)).toBe(doc);
  });

  it('comes back at the very start and the very end of that line', () => {
    expect(visible(doc, lineTwoStart)).toBe(doc);
    expect(visible(doc, doc.indexOf('\nline three'))).toBe(doc);
  });

  it('stays hidden on the line just before and just after', () => {
    expect(visible(doc, 0)).not.toBe(doc);
    expect(visible(doc, doc.length)).not.toBe(doc);
  });

  it('still styles the text on the active line, only revealing the markers', () => {
    expect(kinds(doc, lineTwoStart + 4)).toContain('strong:**bold on line two**');
  });
});

describe('lists and checklists', () => {
  it('turns a bullet into a bullet glyph', () => {
    const r = previewRanges(state('\n\n- item')).find((x) => x.kind === 'bullet');
    expect(r).toBeDefined();
    // The marker and the space after it are both replaced, so the text does not shift.
    expect('\n\n- item'.slice(r!.from, r!.to)).toBe('- ');
  });

  it('leaves an ordered marker alone, because the number is the information', () => {
    expect(previewRanges(state('\n\n1. item')).some((r) => r.kind === 'bullet')).toBe(false);
  });

  it('turns a task marker into a box, ticked or not', () => {
    const off = previewRanges(state('\n\n- [ ] todo')).find((r) => r.kind === 'checkbox');
    const on = previewRanges(state('\n\n- [x] done')).find((r) => r.kind === 'checkbox');
    expect(off?.checked).toBe(false);
    expect(on?.checked).toBe(true);
  });

  it('drops the bullet on a checklist item rather than showing bullet and box', () => {
    const ranges = previewRanges(state('\n\n- [ ] todo'));
    expect(ranges.some((r) => r.kind === 'bullet')).toBe(false);
    expect(ranges.some((r) => r.kind === 'checkbox')).toBe(true);
  });

  it('shows the raw markers again on the line being edited', () => {
    const doc = 'x\n- [ ] todo';
    const at = doc.indexOf('- [ ]') + 2;
    expect(previewRanges(state(doc, at)).some((r) => r.kind === 'checkbox')).toBe(false);
    expect(previewRanges(state(doc, at)).some((r) => r.kind === 'bullet')).toBe(false);
  });
});

describe('activeLines', () => {
  it('is the one line the cursor sits on', () => {
    expect(activeLines(state('a\nb\nc', 2))).toEqual({ from: 2, to: 2 });
  });

  it('covers every line a selection spans', () => {
    const s = EditorState.create({
      doc: 'a\nb\nc',
      selection: { anchor: 0, head: 5 },
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(activeLines(s)).toEqual({ from: 1, to: 3 });
  });
});
