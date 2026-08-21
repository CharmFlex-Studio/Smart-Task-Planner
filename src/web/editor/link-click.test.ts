import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { linkAt } from './link-click.js';

const state = (doc: string) =>
  EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });

describe('linkAt', () => {
  const doc = 'see [the docs](https://example.com/42) and stop';

  it('finds the link under the label', () => {
    expect(linkAt(state(doc), doc.indexOf('docs'))).toBe('https://example.com/42');
  });

  it('finds nothing in the prose either side of it', () => {
    expect(linkAt(state(doc), 1)).toBeNull();
    expect(linkAt(state(doc), doc.indexOf('stop'))).toBeNull();
  });

  it('follows a mailto', () => {
    const d = '[mail](mailto:a@b.c)';
    expect(linkAt(state(d), 2)).toBe('mailto:a@b.c');
  });

  it('follows a relative link into the vault', () => {
    const d = '[other](./other-task.md)';
    expect(linkAt(state(d), 2)).toBe('./other-task.md');
  });

  it('refuses a javascript: link rather than opening it', () => {
    const d = '[click](javascript:alert(1))';
    expect(linkAt(state(d), 2)).toBeNull();
  });

  it('refuses a data: link', () => {
    const d = '[x](data:text/html,hi)';
    expect(linkAt(state(d), 2)).toBeNull();
  });

  it('picks the right one when there are several', () => {
    const d = '[one](https://one.example) then [two](https://two.example)';
    expect(linkAt(state(d), d.indexOf('one') + 1)).toBe('https://one.example');
    expect(linkAt(state(d), d.indexOf('two]') + 1)).toBe('https://two.example');
  });
});
