import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, toggleTaskItem, plainText } from './markdown.js';

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);

describe('inline formatting', () => {
  it('renders emphasis, code and links', () => {
    expect(html('**bold**')).toContain('<strong>bold</strong>');
    expect(html('*italic*')).toContain('<em>italic</em>');
    expect(html('`code`')).toContain('<code>code</code>');
    expect(html('[label](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer noopener">label</a>',
    );
  });

  it('leaves markdown alone inside inline code', () => {
    expect(html('`**not bold**`')).toContain('<code>**not bold**</code>');
    expect(html('`**not bold**`')).not.toContain('<strong>');
  });

  it('nests emphasis inside emphasis', () => {
    expect(html('**bold with `code`**')).toContain('<code>code</code>');
  });
});

/**
 * The whole reason this renderer builds elements instead of HTML. Task files come from
 * shared folders, synced drives and models — none of them the person reading the screen.
 */
describe('it cannot be used to inject anything', () => {
  it('escapes HTML rather than rendering it', () => {
    const out = html('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes a script tag', () => {
    const out = html('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('refuses a javascript: link and shows the text instead', () => {
    const out = html('[click](javascript:alert(1))');
    // What matters is that no such href reaches the DOM. The leftover text is shown as
    // written — across two nodes here, because the link pattern stops at the first ")".
    expect(out).not.toContain('href="javascript');
    expect(out).not.toContain('<a ');
    expect(out).toContain('javascript:alert(1)');
  });

  it('refuses a data: link', () => {
    expect(html('[x](data:text/html,<script>alert(1)</script>)')).not.toContain('href="data:');
  });

  it('allows mailto and relative links', () => {
    expect(html('[mail](mailto:a@b.c)')).toContain('href="mailto:a@b.c"');
    expect(html('[other](./other-task.md)')).toContain('href="./other-task.md"');
  });
});

describe('images and attachments', () => {
  it('renders an embed as an image', () => {
    const out = html('![a screenshot](attachments/shot.png)');
    expect(out).toContain('<img');
    expect(out).toContain('alt="a screenshot"');
    expect(out).toContain('loading="lazy"');
  });

  it('points an attachment link at the endpoint that serves it', () => {
    expect(html('![x](attachments/shot.png)')).toContain('/api/attachments/shot.png');
    expect(html('[report](attachments/report.pdf)')).toContain('/api/attachments/report.pdf');
  });

  it('leaves every other link exactly as written', () => {
    expect(html('[x](https://example.com)')).toContain('href="https://example.com"');
    expect(html('![x](https://example.com/a.png)')).toContain('src="https://example.com/a.png"');
  });

  it('refuses a javascript: source rather than emitting an img for it', () => {
    const out = html('![x](javascript:alert(1))');
    expect(out).not.toContain('<img');
    expect(out).toContain('javascript:alert(1)');
  });

  it('tells an embed from a link by the leading bang', () => {
    expect(html('[not an image](attachments/shot.png)')).not.toContain('<img');
    expect(html('[not an image](attachments/shot.png)')).toContain('<a ');
  });
});

describe('blocks', () => {
  it('renders headings, demoted so a file cannot outrank the page', () => {
    expect(html('# Title')).toContain('<h3>Title</h3>');
    expect(html('## Section')).toContain('<h4>Section</h4>');
  });

  it('renders a fenced code block with its language, unparsed', () => {
    const out = html('```ts\nconst x = **1**;\n```');
    expect(out).toContain('const x = **1**;');
    expect(out).not.toContain('<strong>');
    expect(out).toContain('ts');
  });

  it('renders bullet and ordered lists', () => {
    expect(html('- one\n- two')).toContain('<li>one</li>');
    expect(html('1. one\n2. two')).toContain('<ol');
  });

  it('nests a list inside a list', () => {
    const out = html('- outer\n  - nested');
    expect(out).toContain('outer');
    expect(out).toContain('nested');
    expect(out.indexOf('<ul')).toBeLessThan(out.lastIndexOf('<ul'));
  });

  it('renders a blockquote', () => {
    expect(html('> quoted')).toContain('<blockquote');
  });

  it('renders a table only when the separator row is there', () => {
    expect(html('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table');
    // A stray pipe in prose is prose.
    expect(html('a | b is not a table')).not.toContain('<table');
  });

  it('keeps a paragraph with a line break together', () => {
    expect(html('one\ntwo')).toContain('one\ntwo');
  });
});

describe('checklists', () => {
  it('renders checked and unchecked boxes', () => {
    const out = html('- [ ] todo\n- [x] done');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('checked');
    expect(out).toContain('todo');
    expect(out).toContain('done');
  });

  it('disables the boxes when no toggle handler is given', () => {
    expect(html('- [ ] todo')).toContain('disabled');
  });
});

/**
 * Ticking a box must change three characters, like every other write in this app.
 * Anything that re-serializes the block would reformat what the user wrote around it.
 */
describe('toggleTaskItem', () => {
  const src = 'Intro\n\n- [ ] first\n- [x] second\n- [ ] third\n\nOutro';

  it('ticks the box at the given index', () => {
    expect(toggleTaskItem(src, 0)).toContain('- [x] first');
  });

  it('unticks one that was ticked', () => {
    expect(toggleTaskItem(src, 1)).toContain('- [ ] second');
  });

  it('counts checkboxes in document order', () => {
    const out = toggleTaskItem(src, 2);
    expect(out).toContain('- [ ] first');
    expect(out).toContain('- [x] second');
    expect(out).toContain('- [x] third');
  });

  it('changes nothing else in the text at all', () => {
    const out = toggleTaskItem(src, 0);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.replace('- [x] first', '- [ ] first')).toBe(src);
  });

  it('handles a nested and an ordered checkbox', () => {
    expect(toggleTaskItem('- [ ] a\n  - [ ] b', 1)).toBe('- [ ] a\n  - [x] b');
    expect(toggleTaskItem('1. [ ] a', 0)).toBe('1. [x] a');
  });

  it('leaves the text alone when the index is out of range', () => {
    expect(toggleTaskItem(src, 9)).toBe(src);
    expect(toggleTaskItem('no boxes here', 0)).toBe('no boxes here');
  });

  it('keeps CRLF line endings', () => {
    expect(toggleTaskItem('- [ ] a\r\n- [ ] b', 0)).toBe('- [x] a\r\n- [ ] b');
  });
});

describe('plainText', () => {
  it('takes the markers off and keeps the words', () => {
    expect(plainText('**bold** and *italic* and `code`')).toBe('bold and italic and code');
  });

  it('keeps a link label and drops its target', () => {
    expect(plainText('see [the issue](https://example.com/42)')).toBe('see the issue');
  });

  it('strips heading, list, checkbox and quote markers', () => {
    expect(plainText('## Title')).toBe('Title');
    expect(plainText('- one\n- two')).toBe('one\ntwo');
    expect(plainText('- [x] done')).toBe('done');
    expect(plainText('> quoted')).toBe('quoted');
  });

  it('drops fenced code rather than showing it on a card', () => {
    expect(plainText('before\n```ts\nconst x = 1;\n```\nafter')).toBe('before\n\nafter');
  });

  it('leaves plain prose exactly as it is', () => {
    expect(plainText('Just a sentence.')).toBe('Just a sentence.');
  });
});
