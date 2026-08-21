/**
 * What the toolbar buttons and the keyboard shortcuts actually do to the text.
 *
 * Pure string functions, kept out of the component so every edge — an empty selection, a
 * selection that already carries the marker, a prefix applied across several lines — is
 * testable without a DOM. Each one returns the new text *and* where the caret should end
 * up, because a formatting button that leaves the caret somewhere surprising is worse
 * than no button.
 *
 * Every one of these is a toggle. Pressing bold on text that is already bold takes it
 * off, which is what the shortcut does in every other editor.
 */

export interface Selection {
  start: number;
  end: number;
}

export interface EditResult {
  value: string;
  selection: Selection;
}

/** `'**'` wraps both sides; `['[', '](url)']` opens and closes differently. */
export type Marker = string | [string, string];

function pair(marker: Marker): [string, string] {
  return typeof marker === 'string' ? [marker, marker] : marker;
}

export function applyWrap(
  value: string,
  sel: Selection,
  marker: Marker,
  placeholder: string,
): EditResult {
  const [open, close] = pair(marker);
  const selected = value.slice(sel.start, sel.end);

  // Already wrapped, with the markers inside the selection: take them off.
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length > open.length + close.length - 1) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return {
      value: value.slice(0, sel.start) + inner + value.slice(sel.end),
      selection: { start: sel.start, end: sel.start + inner.length },
    };
  }

  // Already wrapped, with the markers just outside it: take those off instead.
  //
  // Unless those markers are part of a longer run of the same character. Selecting
  // "bold" inside "**bold**" and pressing italic must give "***bold***", not strip one
  // asterisk off each side and silently turn the bold into italics.
  const before = value.slice(Math.max(0, sel.start - open.length), sel.start);
  const after = value.slice(sel.end, sel.end + close.length);
  const runsOn =
    open === close &&
    open.length === 1 &&
    (value.slice(Math.max(0, sel.start - open.length - 1), sel.start - open.length) === open ||
      value.slice(sel.end + close.length, sel.end + close.length + 1) === close);
  if (selected.length > 0 && before === open && after === close && !runsOn) {
    return {
      value:
        value.slice(0, sel.start - open.length) + selected + value.slice(sel.end + close.length),
      selection: { start: sel.start - open.length, end: sel.end - open.length },
    };
  }

  // Nothing selected: drop in a placeholder and select it, so typing replaces it.
  if (sel.start === sel.end) {
    const body = placeholder;
    return {
      value: value.slice(0, sel.start) + open + body + close + value.slice(sel.end),
      selection: { start: sel.start + open.length, end: sel.start + open.length + body.length },
    };
  }

  return {
    value: value.slice(0, sel.start) + open + selected + close + value.slice(sel.end),
    selection: { start: sel.start + open.length, end: sel.end + open.length },
  };
}

/** The line boundaries of every line the selection touches, even partially. */
function lineRange(value: string, sel: Selection): { from: number; to: number } {
  const from = value.lastIndexOf('\n', sel.start - 1) + 1;
  const nextBreak = value.indexOf('\n', sel.end);
  return { from, to: nextBreak === -1 ? value.length : nextBreak };
}

/**
 * Two different questions, which one pattern was answering badly.
 *
 * `EXACT` asks "does this line already carry precisely this prefix", which is what
 * decides whether the button toggles off. `STRIP` asks "what list marker is on this line
 * at all", so applying a different one replaces it instead of stacking a second marker in
 * front of the first. Both work on a line that has already had its indentation removed,
 * so nesting survives.
 */
const EXACT: Record<string, RegExp> = {
  bullet: /^[-*+] (?!\[[ xX]\] )/,
  ordered: /^\d+[.)] (?!\[[ xX]\] )/,
  task: /^[-*+] \[[ xX]\] /,
  quote: /^> ?/,
};

/** Any list marker, with an optional checkbox after it. */
const STRIP_LIST = /^(?:[-*+]|\d+[.)]) +(?:\[[ xX]\] +)?/;
const STRIP_QUOTE = /^> ?/;

function kindOf(prefix: string): keyof typeof EXACT {
  if (/^\d+[.)] $/.test(prefix)) return 'ordered';
  if (/^[-*+] \[[ xX]\] $/.test(prefix)) return 'task';
  if (/^[-*+] $/.test(prefix)) return 'bullet';
  return 'quote';
}

export function applyLinePrefix(value: string, sel: Selection, prefix: string): EditResult {
  const { from, to } = lineRange(value, sel);
  const lines = value.slice(from, to).split('\n');
  const kind = kindOf(prefix);
  const exact = EXACT[kind]!;
  // Quoting a list should keep the list, so a quote only ever strips a quote.
  const strip = kind === 'quote' ? STRIP_QUOTE : STRIP_LIST;
  const ordered = kind === 'ordered';

  const split = (line: string) => {
    const indent = /^(\s*)/.exec(line)![1]!;
    return { indent, body: line.slice(indent.length) };
  };

  // Only strip when every line that has content already carries it; otherwise bring the
  // odd one out into line rather than toggling half of them off.
  const content = lines.filter((l) => l.trim() !== '');
  const allPrefixed = content.length > 0 && content.every((l) => exact.test(split(l).body));

  let n = 0;
  const next = lines.map((line) => {
    if (line.trim() === '') return line;
    const { indent, body } = split(line);
    if (allPrefixed) return indent + body.replace(strip, '');
    n += 1;
    return indent + (ordered ? `${n}. ` : prefix) + body.replace(strip, '');
  });

  const replaced = next.join('\n');
  return {
    value: value.slice(0, from) + replaced + value.slice(to),
    // Select the whole affected block: the caret has moved on every line, and there is no
    // single sensible point to drop it.
    selection: { start: from, end: from + replaced.length },
  };
}
