/**
 * The little markdown we render, and nothing more.
 *
 * Written by hand rather than pulled from a library for one reason that matters: it
 * builds React elements, never an HTML string. There is no `dangerouslySetInnerHTML`
 * anywhere in the path, so a task file cannot inject markup into the page no matter what
 * is written in it — and task files arrive from a shared vault, a synced folder, or a
 * model, none of which are the person reading the screen.
 *
 * The supported subset is what someone actually writes in a task note: emphasis, code,
 * links, lists (nested), checklists, quotes, fenced code, headings and tables. Anything
 * it does not understand is shown as the literal text that was written, which is the
 * right failure for a file the user owns and can see.
 */

import React from 'react';
import { safeUrl } from './safe-url.js';

/* ------------------------------------------------------------------- inline */

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]*\]\([^)\s]*\))/;

function renderInline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let i = key;

  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];

    if (tok.startsWith('`')) {
      out.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={i++}>{renderInline(tok.slice(2, -2), i * 100)}</strong>);
    } else if (tok.startsWith('[')) {
      const split = tok.indexOf('](');
      const label = tok.slice(1, split);
      const href = safeUrl(tok.slice(split + 2, -1));
      out.push(
        href ? (
          <a key={i++} href={href} target="_blank" rel="noreferrer noopener">
            {renderInline(label, i * 100)}
          </a>
        ) : (
          // A scheme we will not follow is shown as what was typed, not silently dropped.
          <span key={i++}>{tok}</span>
        ),
      );
    } else {
      out.push(<em key={i++}>{renderInline(tok.slice(1, -1), i * 100)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

/* -------------------------------------------------------------------- blocks */

interface ListItem {
  /** The item's own first line, already de-bulleted. */
  text: string;
  /** null when the item is not a checklist item. */
  checked: boolean | null;
  /** Position among every checkbox in the document, for toggling the right one. */
  taskIndex: number;
  children: Block[];
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'hr' };

const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```(\S*)\s*$/;
const QUOTE = /^>\s?(.*)$/;
const HR = /^(?:---+|\*\*\*+|___+)\s*$/;
const TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

/** Indentation of a list line, used to decide what nests under what. */
function indentOf(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m ? m[1]!.replace(/\t/g, '  ').length : 0;
}

function parseBlocks(lines: string[], counter: { n: number }): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code first: nothing inside it is markdown.
    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // the closing fence, or the end of the input
      blocks.push({ kind: 'code', lang, code: body.join('\n') });
      continue;
    }

    if (HR.test(line) && !BULLET.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        inner.push(QUOTE.exec(lines[i++]!)![1]!);
      }
      blocks.push({ kind: 'quote', children: parseBlocks(inner, counter) });
      continue;
    }

    // A table needs its separator row to be a table at all, which is what keeps a stray
    // line containing a pipe from being swallowed as one.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(splitRow(lines[i++]!));
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[2]!);
      const baseIndent = indentOf(line);
      const items: ListItem[] = [];

      while (i < lines.length) {
        const m = BULLET.exec(lines[i]!);
        if (!m || indentOf(lines[i]!) < baseIndent) break;
        if (indentOf(lines[i]!) > baseIndent) break; // handled below as a child
        if (/\d/.test(m[2]!) !== ordered) break;
        i++;

        let body = m[3]!;
        const task = TASK.exec(body);
        const checked = task ? task[1]!.toLowerCase() === 'x' : null;
        if (task) body = task[2]!;

        // Everything indented past this item belongs to it.
        const nested: string[] = [];
        while (i < lines.length) {
          const l = lines[i]!;
          if (l.trim() === '') {
            // A blank line only continues the item if something indented follows it.
            const next = lines[i + 1];
            if (next !== undefined && next.trim() !== '' && indentOf(next) > baseIndent) {
              nested.push('');
              i++;
              continue;
            }
            break;
          }
          if (indentOf(l) <= baseIndent) break;
          nested.push(l.slice(baseIndent + 2));
          i++;
        }

        items.push({
          text: body,
          checked,
          taskIndex: checked === null ? -1 : counter.n++,
          children: nested.length ? parseBlocks(nested, counter) : [],
        });
      }

      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Anything else is a paragraph, running until a blank line or a block that starts.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (
        l.trim() === '' ||
        FENCE.test(l) ||
        HEADING.test(l) ||
        QUOTE.test(l) ||
        BULLET.test(l) ||
        HR.test(l)
      ) {
        break;
      }
      para.push(l);
      i++;
    }
    blocks.push({ kind: 'p', text: para.join('\n') });
  }

  return blocks;
}

/* ------------------------------------------------------------------ rendering */

export interface MarkdownOptions {
  /** Called with the index of a checkbox the reader clicked. Omit to render them read-only. */
  onToggleTask?: (index: number) => void;
}

function renderBlocks(blocks: Block[], opts: MarkdownOptions, keyBase = ''): React.ReactNode {
  return blocks.map((b, i) => {
    const key = `${keyBase}${i}`;
    switch (b.kind) {
      case 'h': {
        // Heading levels are clamped: a task description sits inside the page, and an
        // <h1> from a file should not outrank the screen's own headings.
        const Tag = `h${Math.min(6, b.level + 2)}` as 'h3';
        return <Tag key={key}>{renderInline(b.text)}</Tag>;
      }
      case 'code':
        return (
          <pre className="md-code" key={key} data-lang={b.lang || undefined}>
            {b.lang ? <span className="md-code-lang">{b.lang}</span> : null}
            <code>{b.code}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote className="md-quote" key={key}>
            {renderBlocks(b.children, opts, `${key}-`)}
          </blockquote>
        );
      case 'hr':
        return <hr className="md-hr" key={key} />;
      case 'table':
        return (
          // Wide tables scroll inside themselves rather than stretching the panel.
          <div className="md-table-wrap" key={key}>
            <table className="md-table">
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j}>{renderInline(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((c, k) => (
                      <td key={k}>{renderInline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        const isTaskList = b.items.some((it) => it.checked !== null);
        return (
          <Tag className={isTaskList ? 'md-tasks' : 'md-list'} key={key}>
            {b.items.map((item, j) => (
              <li key={j} className={item.checked !== null ? 'md-task' : undefined}>
                {item.checked !== null ? (
                  <label className={item.checked ? 'md-checked' : undefined}>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={!opts.onToggleTask}
                      onChange={() => opts.onToggleTask?.(item.taskIndex)}
                    />
                    <span>{renderInline(item.text)}</span>
                  </label>
                ) : (
                  renderInline(item.text)
                )}
                {item.children.length ? renderBlocks(item.children, opts, `${key}-${j}-`) : null}
              </li>
            ))}
          </Tag>
        );
      }
      default:
        return <p key={key}>{renderInline(b.text)}</p>;
    }
  });
}

/** Render markdown as React elements. Never returns HTML, and never parses any. */
export function Markdown({
  source,
  options = {},
  className,
}: {
  source: string;
  options?: MarkdownOptions;
  className?: string;
}) {
  const blocks = React.useMemo(
    () => parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), { n: 0 }),
    [source],
  );
  return <div className={className ? `md ${className}` : 'md'}>{renderBlocks(blocks, options)}</div>;
}

/**
 * Flip the nth checkbox in the source and hand back the new text.
 *
 * Deliberately a string edit on the one line that holds that checkbox: clicking a box
 * must change those three characters and nothing else, exactly like every other write in
 * this app. Re-serializing the block from a parse tree would quietly reformat whatever
 * else the person had written around it.
 */
export function toggleTaskItem(source: string, index: number): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r\n?|\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/.exec(lines[i]!);
    if (!m) continue;
    if (seen === index) {
      const next = m[2]!.toLowerCase() === 'x' ? ' ' : 'x';
      lines[i] = m[1]! + next + m[3]! + lines[i]!.slice(m[0]!.length);
      return lines.join(eol);
    }
    seen++;
  }
  return source;
}

/**
 * Markdown reduced to the words in it, for places too small to render into.
 *
 * A board card is one line in a dense column: rendering markdown there would drag in
 * headings, lists and tables and blow the card open. Showing the raw source instead
 * leaves `**asterisks**` on screen. So the markers come off and the text stays.
 */
export function plainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code, wholesale
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')       // heading markers
    .replace(/^\s*>\s?/gm, '')                // quote markers
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '') // list and checkbox markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their label
    .replace(/(\*\*|__)(.*?)\1/g, '$2')      // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')          // italic
    .replace(/`([^`]*)`/g, '$1')              // inline code
    .replace(/^\s*(?:---+|\*\*\*+|___+)\s*$/gm, ' ') // rules
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +$/gm, '')   // a line left holding only the space a block was replaced by
    .trim();
}
