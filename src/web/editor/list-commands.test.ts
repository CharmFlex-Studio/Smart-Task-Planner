import { describe, it, expect } from 'vitest';
import { parseListLine, nextMarker, continuation, shiftIndent } from './list-commands.js';

describe('parseListLine', () => {
  it('takes a bullet apart', () => {
    expect(parseListLine('- milk')).toEqual({
      indent: '', marker: '-', gap: ' ', task: null, rest: 'milk',
    });
  });

  it('keeps the indentation of a nested item', () => {
    expect(parseListLine('    - nested')?.indent).toBe('    ');
  });

  it('recognises a checklist item', () => {
    expect(parseListLine('- [x] done')).toMatchObject({ task: '[x]', rest: 'done' });
    expect(parseListLine('- [ ] todo')).toMatchObject({ task: '[ ]', rest: 'todo' });
  });

  it('recognises an ordered item', () => {
    expect(parseListLine('3. third')).toMatchObject({ marker: '3.', rest: 'third' });
    expect(parseListLine('3) third')).toMatchObject({ marker: '3)' });
  });

  it('is null for anything that is not a list line', () => {
    expect(parseListLine('just prose')).toBeNull();
    expect(parseListLine('# heading')).toBeNull();
    expect(parseListLine('')).toBeNull();
  });
});

describe('nextMarker', () => {
  it('counts an ordered list on', () => {
    expect(nextMarker('1.')).toBe('2.');
    expect(nextMarker('9)')).toBe('10)');
  });

  it('leaves a bullet as it is', () => {
    expect(nextMarker('-')).toBe('-');
    expect(nextMarker('*')).toBe('*');
  });
});

describe('continuation', () => {
  it('carries the bullet onto the next line', () => {
    expect(continuation('- milk')).toEqual({ insert: '\n- ' });
  });

  it('carries the indentation too', () => {
    expect(continuation('    - nested')).toEqual({ insert: '\n    - ' });
  });

  it('counts an ordered list on', () => {
    expect(continuation('2. second')).toEqual({ insert: '\n3. ' });
  });

  it('gives a checklist item a fresh, unticked box', () => {
    expect(continuation('- [x] done')).toEqual({ insert: '\n- [ ] ' });
  });

  it('ends the list when the item is empty, rather than adding another', () => {
    expect(continuation('- ')).toEqual({ clearLine: true });
    expect(continuation('- [ ] ')).toEqual({ clearLine: true });
    expect(continuation('  1. ')).toEqual({ clearLine: true });
  });

  it('leaves ordinary lines alone, so Enter is just Enter', () => {
    expect(continuation('some prose')).toBeNull();
    expect(continuation('> quoted')).toBeNull();
  });
});

describe('shiftIndent', () => {
  it('indents by one level', () => {
    expect(shiftIndent('- milk', 1)).toBe('  - milk');
  });

  it('outdents by one level', () => {
    expect(shiftIndent('  - milk', -1)).toBe('- milk');
  });

  it('will not outdent past the margin', () => {
    expect(shiftIndent('- milk', -1)).toBeNull();
  });

  it('normalises odd indentation on the way out', () => {
    expect(shiftIndent('\t - milk', -1)).toBe('- milk');
  });

  it('ignores lines that are not list items', () => {
    expect(shiftIndent('prose', 1)).toBeNull();
  });
});
