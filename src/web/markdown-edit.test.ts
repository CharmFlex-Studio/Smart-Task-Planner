import { describe, it, expect } from 'vitest';
import { applyWrap, applyLinePrefix } from './markdown-edit.js';

const at = (start: number, end = start) => ({ start, end });
/** Render the result as text with the selection marked, so assertions read like the UI. */
const show = (r: { value: string; selection: { start: number; end: number } }) =>
  r.value.slice(0, r.selection.start) +
  '[' +
  r.value.slice(r.selection.start, r.selection.end) +
  ']' +
  r.value.slice(r.selection.end);

describe('applyWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(show(applyWrap('make me bold', at(8, 12), '**', 'bold text'))).toBe(
      'make me **[bold]**',
    );
  });

  it('drops in a selected placeholder when nothing is selected', () => {
    expect(show(applyWrap('', at(0), '**', 'bold text'))).toBe('**[bold text]**');
  });

  it('unwraps when the markers are inside the selection', () => {
    expect(show(applyWrap('a **bold** b', at(2, 10), '**', 'bold text'))).toBe('a [bold] b');
  });

  it('unwraps when the markers sit just outside the selection', () => {
    expect(show(applyWrap('a **bold** b', at(4, 8), '**', 'bold text'))).toBe('a [bold] b');
  });

  it('handles different open and close markers', () => {
    expect(show(applyWrap('see docs', at(4, 8), ['[', '](https://)'], 'label'))).toBe(
      'see [[docs]](https://)',
    );
  });

  it('wraps italics without eating the bold markers around it', () => {
    expect(applyWrap('**bold**', at(2, 6), '*', 'italic text').value).toBe('***bold***');
  });

  it('leaves the rest of the text untouched', () => {
    const src = 'one two three';
    expect(applyWrap(src, at(4, 7), '`', 'code').value).toBe('one `two` three');
  });
});

describe('applyLinePrefix', () => {
  it('adds a bullet to a single line', () => {
    expect(applyLinePrefix('milk', at(0), '- ').value).toBe('- milk');
  });

  it('adds a bullet to every line the selection touches', () => {
    expect(applyLinePrefix('milk\neggs\nbread', at(0, 10), '- ').value).toBe(
      '- milk\n- eggs\n- bread',
    );
  });

  it('removes the bullets when every line already has one', () => {
    expect(applyLinePrefix('- milk\n- eggs', at(0, 13), '- ').value).toBe('milk\neggs');
  });

  it('brings the odd line into line rather than toggling half of them off', () => {
    expect(applyLinePrefix('- milk\neggs', at(0, 11), '- ').value).toBe('- milk\n- eggs');
  });

  it('numbers an ordered list sequentially', () => {
    expect(applyLinePrefix('one\ntwo\nthree', at(0, 13), '1. ').value).toBe(
      '1. one\n2. two\n3. three',
    );
  });

  it('renumbers rather than stacking prefixes', () => {
    expect(applyLinePrefix('1. one\n2. two', at(0, 13), '1. ').value).toBe('one\ntwo');
  });

  it('makes a checklist, and tells it apart from a plain bullet', () => {
    expect(applyLinePrefix('buy milk', at(0), '- [ ] ').value).toBe('- [ ] buy milk');
    // A plain bullet applied to a checklist item replaces the checkbox, not doubles it.
    expect(applyLinePrefix('- [ ] buy milk', at(0), '- ').value).toBe('- buy milk');
  });

  it('turns a bullet into a checklist item without doubling the dash', () => {
    expect(applyLinePrefix('- buy milk', at(0), '- [ ] ').value).toBe('- [ ] buy milk');
  });

  it('quotes a block', () => {
    expect(applyLinePrefix('a\nb', at(0, 3), '> ').value).toBe('> a\n> b');
  });

  it('skips blank lines inside the selection', () => {
    expect(applyLinePrefix('a\n\nb', at(0, 4), '- ').value).toBe('- a\n\n- b');
  });

  it('leaves text outside the touched lines alone', () => {
    const src = 'keep\nchange\nkeep too';
    expect(applyLinePrefix(src, at(5, 11), '- ').value).toBe('keep\n- change\nkeep too');
  });

  it('works when the caret is mid-line rather than at the start', () => {
    expect(applyLinePrefix('milk', at(2), '- ').value).toBe('- milk');
  });
});
