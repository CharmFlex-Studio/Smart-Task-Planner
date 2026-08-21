/**
 * The keys that make a list feel like a list.
 *
 * Pure functions over the line text, so the behaviour — what Enter does on a full item,
 * on an empty one, halfway through the text — is testable without an editor.
 */

/** A list line, taken apart. */
export interface ListLine {
  indent: string;
  /** `-`, `*`, `+`, or `1.` / `1)`. */
  marker: string;
  /** The whitespace between the marker and what follows. */
  gap: string;
  /** The `[ ]` or `[x]` of a checklist item, if there is one. */
  task: string | null;
  /** Everything after all of that. */
  rest: string;
}

const LIST_LINE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;

export function parseListLine(text: string): ListLine | null {
  const m = LIST_LINE.exec(text);
  if (!m) return null;
  return {
    indent: m[1]!,
    marker: m[2]!,
    gap: m[3]!,
    task: m[4] ? m[4].trim() : null,
    rest: m[5]!,
  };
}

/** `1.` becomes `2.`; a bullet stays itself. */
export function nextMarker(marker: string): string {
  const m = /^(\d+)([.)])$/.exec(marker);
  return m ? `${Number(m[1]) + 1}${m[2]}` : marker;
}

/**
 * What Enter should insert to continue this list, or null to let Enter be Enter.
 *
 * An item with nothing in it ends the list instead of adding another empty bullet —
 * pressing Enter twice is how everyone leaves a list, and a version that keeps handing
 * out bullets has to be escaped some other way.
 */
export function continuation(text: string): { insert: string } | { clearLine: true } | null {
  const line = parseListLine(text);
  if (!line) return null;
  if (line.rest.trim() === '') return { clearLine: true };
  const marker = nextMarker(line.marker);
  return { insert: `\n${line.indent}${marker}${line.gap}${line.task ? '[ ] ' : ''}` };
}

/** One level of indentation, as this editor writes it. */
export const INDENT = '  ';

/** Indent or outdent a list line, keeping everything else about it. */
export function shiftIndent(text: string, direction: 1 | -1): string | null {
  const line = parseListLine(text);
  if (!line) return null;
  if (direction === 1) return INDENT + text;
  if (line.indent.startsWith(INDENT)) return text.slice(INDENT.length);
  if (line.indent.length > 0) return text.replace(/^[ \t]+/, '');
  return null;
}
