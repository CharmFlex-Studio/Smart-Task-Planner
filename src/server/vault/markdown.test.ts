import { describe, it, expect } from 'vitest';
import {
  parseTaskFile,
  serializeNewTask,
  setDescription,
  setFrontmatterField,
  appendLogEntry,
  formatLogLine,
  logEntryRanges,
  replaceLogEntry,
  removeLogEntry,
} from './markdown.js';

const FULL = `---
id: 01JQ8ZK3M4N5P6Q7R8S9T0V1W2
title: Improve Korean live translation
status: in-progress
created: 2026-08-20T09:30:00+08:00
updated: 2026-08-20T17:20:00+08:00
due: 2026-08-25
tags: [translation, latency]
---

Latency on live translation is too high on mid-range devices.

## Log

- 2026-08-20 09:30 · progress · Started investigating translation delay
- 2026-08-20 10:40 · discovery · Sentence buffering adds ~600 ms
- 2026-08-20 16:30 · decision · Keep two previous segments as context
`;

describe('parseTaskFile', () => {
  it('reads frontmatter, description and log', () => {
    const p = parseTaskFile(FULL, 'tasks/t.md');
    expect(p.fields.id).toBe('01JQ8ZK3M4N5P6Q7R8S9T0V1W2');
    expect(p.fields.title).toBe('Improve Korean live translation');
    expect(p.fields.status).toBe('in-progress');
    expect(p.fields.due).toBe('2026-08-25');
    expect(p.fields.tags).toEqual(['translation', 'latency']);
    expect(p.description).toBe('Latency on live translation is too high on mid-range devices.');
    expect(p.log).toHaveLength(3);
    expect(p.log[0]).toEqual({
      at: '2026-08-20T09:30',
      type: 'progress',
      text: 'Started investigating translation delay',
    });
    expect(p.log[2]!.type).toBe('decision');
  });

  it('tolerates a file with no frontmatter and derives a stable id from the path', () => {
    const a = parseTaskFile('# Just a note\n\nsome text\n', 'tasks/note.md');
    const b = parseTaskFile('# Just a note\n\nsome text\n', 'tasks/note.md');
    expect(a.fields.id).toBe(b.fields.id);
    expect(a.fields.title).toBe('Just a note');
    expect(a.fields.status).toBe('todo');
    expect(a.hasFrontmatter).toBe(false);
  });

  it('falls back to the filename when there is no title anywhere', () => {
    const p = parseTaskFile('some body\n', 'tasks/pay-the-rent.md');
    expect(p.fields.title).toBe('pay the rent');
  });

  it('accepts a log entry with no type and calls it a note', () => {
    const p = parseTaskFile(`---\nid: x\ntitle: T\n---\n\n## Log\n\n- 2026-08-20 09:30 · plain text here\n`, 'tasks/t.md');
    expect(p.log[0]).toEqual({ at: '2026-08-20T09:30', type: 'note', text: 'plain text here' });
  });

  it('joins indented continuation lines into the previous entry', () => {
    const src = `---\nid: x\ntitle: T\n---\n\n## Log\n\n- 2026-08-20 09:30 · note · first line\n  second line\n- 2026-08-20 10:00 · note · other\n`;
    const p = parseTaskFile(src, 'tasks/t.md');
    expect(p.log).toHaveLength(2);
    expect(p.log[0]!.text).toBe('first line\nsecond line');
  });

  /**
   * Markdown in a comment is only worth offering if what comes back out is what went in.
   * Indentation past the two-space continuation prefix is structure, not decoration:
   * trimming it turns a nested list flat and lifts a fenced block out of its list item.
   */
  it('round-trips nested lists, blank lines and code fences in a comment', () => {
    const text = 'Findings:\n- outer\n  - nested\n\n```ts\nconst x = 1;\n```';
    const line = formatLogLine({ at: '2026-08-21T09:04', type: 'note', text });
    const src = `---\nid: x\ntitle: T\n---\n\n## Log\n\n${line}\n`;
    expect(parseTaskFile(src, 'tasks/t.md').log[0]!.text).toBe(text);
  });

  it('keeps a blank line inside an entry, which closes a fence', () => {
    const text = 'before\n\nafter';
    const line = formatLogLine({ at: '2026-08-21T09:04', type: 'note', text });
    const src = `---\nid: x\ntitle: T\n---\n\n## Log\n\n${line}\n`;
    expect(parseTaskFile(src, 'tasks/t.md').log[0]!.text).toBe(text);
  });

  it('an empty line still separates entries rather than joining them', () => {
    const src =
      `---\nid: x\ntitle: T\n---\n\n## Log\n\n` +
      `- 2026-08-20 09:30 · note · first\n\n- 2026-08-20 10:00 · note · second\n`;
    const p = parseTaskFile(src, 'tasks/t.md');
    expect(p.log.map((e) => e.text)).toEqual(['first', 'second']);
  });

  it('still trims a continuation indented some other way, as older vaults are', () => {
    const src =
      `---\nid: x\ntitle: T\n---\n\n## Log\n\n` +
      `- 2026-08-20 09:30 · note · first\n\t  second\n`;
    expect(parseTaskFile(src, 'tasks/t.md').log[0]!.text).toBe('first\nsecond');
  });

  it('keeps unparseable junk out of the log without throwing', () => {
    const src = `---\nid: x\ntitle: T\n---\n\n## Log\n\nnot a bullet at all\n- 2026-08-20 09:30 · note · real\n`;
    const p = parseTaskFile(src, 'tasks/t.md');
    expect(p.log).toHaveLength(1);
    expect(p.log[0]!.text).toBe('real');
  });

  it('survives broken yaml rather than losing the whole file', () => {
    const src = `---\ntitle: [unclosed\n---\n\nbody\n`;
    const p = parseTaskFile(src, 'tasks/broken.md');
    expect(p.problems.length).toBeGreaterThan(0);
    expect(p.description).toBe('body');
  });
});

describe('surgical writes preserve everything they did not touch', () => {
  it('setFrontmatterField replaces exactly one line', () => {
    const out = setFrontmatterField(FULL, 'status', 'done');
    expect(out).toContain('status: done');
    expect(out).not.toContain('status: in-progress');
    // every other byte is identical
    expect(out.replace('status: done', 'status: in-progress')).toBe(FULL);
  });

  it('setFrontmatterField adds a missing key before the closing fence', () => {
    const src = `---\nid: x\ntitle: T\n---\n\nbody\n`;
    const out = setFrontmatterField(src, 'due', '2026-09-01');
    expect(out).toBe(`---\nid: x\ntitle: T\ndue: 2026-09-01\n---\n\nbody\n`);
  });

  it('setFrontmatterField deletes a key when the value is undefined', () => {
    const out = setFrontmatterField(FULL, 'due', undefined);
    expect(out).not.toContain('due:');
    expect(out).toContain('tags: [translation, latency]');
  });

  it('setFrontmatterField writes arrays in flow style', () => {
    const out = setFrontmatterField(FULL, 'tags', ['a', 'b c']);
    expect(out).toContain('tags: [a, b c]');
  });

  it('setFrontmatterField quotes values that would break yaml', () => {
    const out = setFrontmatterField(FULL, 'title', 'a: b #c');
    const p = parseTaskFile(out, 'tasks/t.md');
    expect(p.fields.title).toBe('a: b #c');
  });

  it('setFrontmatterField creates frontmatter on a file that has none', () => {
    const out = setFrontmatterField('# Note\n\nbody\n', 'status', 'done');
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('status: done');
    expect(out).toContain('# Note');
  });

  it('appendLogEntry only adds to the tail', () => {
    const out = appendLogEntry(FULL, {
      at: '2026-08-21T08:00',
      type: 'blocker',
      text: 'waiting on device',
    });
    expect(out.startsWith(FULL)).toBe(true);
    expect(out.trimEnd().endsWith('- 2026-08-21 08:00 · blocker · waiting on device')).toBe(true);
  });

  it('appendLogEntry creates the Log section when absent', () => {
    const src = `---\nid: x\ntitle: T\n---\n\nsome description\n`;
    const out = appendLogEntry(src, { at: '2026-08-21T08:00', type: 'note', text: 'hi' });
    expect(out).toContain('## Log');
    expect(parseTaskFile(out, 'tasks/t.md').log).toHaveLength(1);
    expect(parseTaskFile(out, 'tasks/t.md').description).toBe('some description');
  });

  it('appendLogEntry indents multi-line text so it round-trips', () => {
    const out = appendLogEntry(FULL, { at: '2026-08-21T08:00', type: 'note', text: 'one\ntwo' });
    const p = parseTaskFile(out, 'tasks/t.md');
    expect(p.log.at(-1)!.text).toBe('one\ntwo');
  });

  it('respects CRLF files', () => {
    const crlf = FULL.replace(/\n/g, '\r\n');
    const out = appendLogEntry(crlf, { at: '2026-08-21T08:00', type: 'note', text: 'hi' });
    expect(out).not.toMatch(/[^\r]\n/);
    expect(parseTaskFile(out, 'tasks/t.md').log).toHaveLength(4);
  });
});

describe('setDescription', () => {
  it('replaces the prose and leaves frontmatter and log untouched', () => {
    const out = setDescription(FULL, 'A completely different summary.');
    expect(out).toContain('A completely different summary.');
    expect(out).not.toContain('Latency on live translation');
    const p = parseTaskFile(out, 'tasks/t.md');
    expect(p.description).toBe('A completely different summary.');
    expect(p.fields.title).toBe('Improve Korean live translation');
    expect(p.log).toHaveLength(3);
    expect(out).toContain('- 2026-08-20 09:30 · progress · Started investigating translation delay');
  });

  it('writing back what was read changes nothing at all', () => {
    const p = parseTaskFile(FULL, 'tasks/t.md');
    expect(setDescription(FULL, p.description)).toBe(FULL);
  });

  it('keeps a multi-line description, blank lines and all', () => {
    const text = 'First paragraph.\n\n- a bullet\n- another';
    const p = parseTaskFile(setDescription(FULL, text), 'tasks/t.md');
    expect(p.description).toBe(text);
  });

  it('clears the description without disturbing the log', () => {
    const out = setDescription(FULL, '   ');
    const p = parseTaskFile(out, 'tasks/t.md');
    expect(p.description).toBe('');
    expect(p.log).toHaveLength(3);
    expect(out).toContain('due: 2026-08-25');
  });

  it('adds a description to a file that has none', () => {
    const src = `---\nid: x\ntitle: T\n---\n\n## Log\n\n- 2026-08-20 09:30 · note · hi\n`;
    const out = setDescription(src, 'now it has one');
    expect(parseTaskFile(out, 'tasks/t.md').description).toBe('now it has one');
    expect(parseTaskFile(out, 'tasks/t.md').log).toHaveLength(1);
  });

  it('works on a file with no frontmatter at all', () => {
    const out = setDescription('just prose\n', 'different prose');
    expect(parseTaskFile(out, 'tasks/t.md').description).toBe('different prose');
  });

  it('respects CRLF files', () => {
    const crlf = FULL.replace(/\n/g, '\r\n');
    const out = setDescription(crlf, 'new text');
    expect(out).not.toMatch(/[^\r]\n/);
    expect(parseTaskFile(out, 'tasks/t.md').description).toBe('new text');
  });
});

describe('round trip', () => {
  const CORPUS = [
    FULL,
    '---\nid: a\ntitle: T\n---\n',
    '---\nid: a\ntitle: T\nweird_custom_key: kept\n---\n\nbody\n\n## Log\n\n- 2026-01-01 00:00 · note · x\n',
    '# no frontmatter\n\njust prose\n',
    '',
    '---\nid: a\ntitle: T\n---\n\n## Notes\n\nnot a log heading\n',
  ];

  it('parse -> serialize is identity on files we never edit', () => {
    for (const src of CORPUS) {
      const p = parseTaskFile(src, 'tasks/x.md');
      expect(p.raw).toBe(src);
    }
  });

  it('an edit preserves unknown frontmatter keys', () => {
    const src = '---\nid: a\ntitle: T\nweird_custom_key: kept\n---\n\nbody\n';
    const out = setFrontmatterField(src, 'status', 'done');
    expect(out).toContain('weird_custom_key: kept');
  });
});

describe('serializeNewTask', () => {
  it('produces a file that parses back to what went in', () => {
    const src = serializeNewTask(
      {
        id: '01J',
        title: 'Ship the thing',
        status: 'in-progress',
        created: '2026-08-20T10:00:00+08:00',
        updated: '2026-08-20T10:00:00+08:00',
        tags: ['work'],
      },
      'why it matters',
    );
    const p = parseTaskFile(src, 'tasks/ship-the-thing.md');
    expect(p.fields.title).toBe('Ship the thing');
    expect(p.fields.status).toBe('in-progress');
    expect(p.description).toBe('why it matters');
    expect(p.fields.tags).toEqual(['work']);
    expect(p.log).toHaveLength(0);
    expect(src).toContain('## Log');
  });
});

/**
 * Editing a comment has to touch that comment and nothing else, like every other write
 * here. These pin that down on a file with the awkward shapes: entries that span several
 * lines, two comments with identical text, and junk between them.
 */
describe('editing and removing a comment', () => {
  const FILE = [
    '---',
    'id: x',
    'title: T',
    '---',
    '',
    'The description.',
    '',
    '## Log',
    '',
    '- 2026-08-20 09:30 · note · first',
    '- 2026-08-20 10:00 · note · second, which',
    '  runs onto a second line',
    '- 2026-08-20 11:00 · note · first',
    '',
  ].join('\n');

  it('finds the lines each entry occupies, continuations included', () => {
    expect(logEntryRanges(FILE)).toEqual([
      { from: 9, to: 9 },
      { from: 10, to: 11 },
      { from: 12, to: 12 },
    ]);
  });

  it('rewrites one entry and leaves every other line alone', () => {
    const out = replaceLogEntry(FILE, 0, {
      at: '2026-08-20T09:30',
      type: 'note',
      text: 'first, corrected',
    });
    expect(out.split('\n')[9]).toBe('- 2026-08-20 09:30 · note · first, corrected');
    // Everything else is byte-identical.
    const before = FILE.split('\n');
    const after = out.split('\n');
    before.forEach((line, i) => {
      if (i !== 9) expect(after[i]).toBe(line);
    });
  });

  it('rewrites a multi-line entry, replacing all of its lines', () => {
    const out = replaceLogEntry(FILE, 1, {
      at: '2026-08-20T10:00',
      type: 'note',
      text: 'now one line',
    });
    expect(out).toContain('- 2026-08-20 10:00 · note · now one line');
    expect(out).not.toContain('runs onto a second line');
    expect(parseTaskFile(out, 'tasks/t.md').log).toHaveLength(3);
  });

  it('can grow an entry from one line to several', () => {
    const out = replaceLogEntry(FILE, 0, {
      at: '2026-08-20T09:30',
      type: 'note',
      text: 'first\nwith more\n- and a list',
    });
    expect(parseTaskFile(out, 'tasks/t.md').log[0]!.text).toBe('first\nwith more\n- and a list');
    expect(parseTaskFile(out, 'tasks/t.md').log).toHaveLength(3);
  });

  it('removes one entry, and only its lines', () => {
    const out = removeLogEntry(FILE, 1);
    const log = parseTaskFile(out, 'tasks/t.md').log;
    expect(log.map((e) => e.text)).toEqual(['first', 'first']);
    expect(out).toContain('The description.');
    expect(out).toContain('## Log');
  });

  it('tells two identical comments apart by position, not by text', () => {
    const out = removeLogEntry(FILE, 2);
    const log = parseTaskFile(out, 'tasks/t.md').log;
    expect(log.map((e) => e.at)).toEqual(['2026-08-20T09:30', '2026-08-20T10:00']);
  });

  it('leaves the file alone when the index is not there', () => {
    expect(replaceLogEntry(FILE, 9, { at: '2026-08-20T09:30', type: 'note', text: 'x' })).toBe(FILE);
    expect(removeLogEntry(FILE, 9)).toBe(FILE);
    expect(removeLogEntry('no log here at all', 0)).toBe('no log here at all');
  });

  it('keeps CRLF line endings', () => {
    const crlf = FILE.replace(/\n/g, '\r\n');
    const out = removeLogEntry(crlf, 0);
    expect(out.includes('\r\n')).toBe(true);
    expect(out.split('\r\n').some((l) => l.includes('09:30'))).toBe(false);
  });
});
