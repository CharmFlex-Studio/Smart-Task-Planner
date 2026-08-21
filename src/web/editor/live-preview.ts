/**
 * Markdown that styles itself as you type, and hides its own syntax.
 *
 * The document is never anything but the markdown text — every effect here is a
 * decoration, which is CodeMirror's word for "draw this differently". Nothing rewrites
 * the buffer, so what is saved is exactly what was typed, marker for marker. That is the
 * whole reason for building it this way rather than on a rich-text model that serializes
 * back to markdown: those normalise, and this app's files are the truth.
 *
 * The markers reappear on the line the cursor is on. Without that you can see the effect
 * but cannot get at the characters causing it, which makes fixing a stray asterisk a
 * guessing game.
 */

import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

/** A marker to hide, or a span to style. Kept plain so it can be tested without a DOM. */
export interface PreviewRange {
  from: number;
  to: number;
  /** `hide` removes the characters visually; the rest are style classes. */
  kind:
    | 'hide'
    | 'strong'
    | 'em'
    | 'strike'
    | 'code'
    | 'link'
    | 'url'
    | 'heading'
    | 'quote'
    | 'bullet'
    | 'checkbox'
    | 'line';
  /** Heading level, when kind is 'heading'. */
  level?: number;
  /** Whether the box is ticked, when kind is 'checkbox'. */
  checked?: boolean;
  /** Class for a whole-line decoration, when kind is 'line'. */
  lineClass?: string;
  /** Inline style for a whole-line decoration — the hanging indent, which is per-line. */
  style?: string;
}

/** Inline marks that are pure syntax and carry no meaning once the effect is visible. */
const HIDDEN_MARKS = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'LinkMark',
  'HeaderMark',
  'QuoteMark',
]);

const STYLED: Record<string, PreviewRange['kind']> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  Strikethrough: 'strike',
  InlineCode: 'code',
};

/**
 * Which lines must keep their syntax visible: the ones the selection touches.
 *
 * A range rather than a single line, because a selection can span several and every line
 * being edited should show what it is made of.
 */
export function activeLines(state: EditorState): { from: number; to: number } {
  const { from, to } = state.selection.main;
  return { from: state.doc.lineAt(from).number, to: state.doc.lineAt(to).number };
}

/**
 * Work out every decoration for the current document.
 *
 * Pure, and deliberately free of anything that needs a browser, so the interesting
 * behaviour — what gets hidden, and what stops being hidden when the cursor arrives —
 * is testable as data rather than by squinting at a screenshot.
 */
export function previewRanges(state: EditorState): PreviewRange[] {
  const out: PreviewRange[] = [];
  const active = activeLines(state);
  const onActiveLine = (pos: number) => {
    const line = state.doc.lineAt(pos).number;
    return line >= active.from && line <= active.to;
  };

  /**
   * Hang the wrapped rows of a list item under its text instead of back at the margin.
   *
   * A negative text-indent cancelled by an equal padding does that, and it has to be
   * per-line because the amount depends on how deep the item is nested. In ems rather
   * than ch because the editor is set in a proportional face, where a character has no
   * fixed width — so this lines up by eye rather than exactly, which is the best a
   * proportional font allows.
   */
  const hang = (line: { from: number; text: string }, extra = 0) => {
    const indent = /^[ \t]*/.exec(line.text)![0].replace(/\t/g, '  ').length;
    const em = (indent / 2) * 1.4 + 1.6 + extra;
    out.push({
      from: line.from,
      to: line.from,
      kind: 'line',
      lineClass: 'cm-md-listline',
      style: `padding-left:${em}em;text-indent:-${em}em`,
    });
  };

  syntaxTree(state).iterate({
    enter(node) {
      const name = node.name;

      // Whole-line treatments. Applied per line so they survive wrapping, which is where
      // the block-level look actually has to hold up.
      if (name === 'ListItem') {
        const line = state.doc.lineAt(node.from);
        hang(line);
        return;
      }
      if (name === 'Blockquote') {
        for (let p = node.from; p <= node.to; ) {
          const line = state.doc.lineAt(p);
          out.push({ from: line.from, to: line.from, kind: 'line', lineClass: 'cm-md-quoteline' });
          if (line.to >= node.to) break;
          p = line.to + 1;
        }
        out.push({ from: node.from, to: node.to, kind: 'quote' });
        return;
      }
      if (name === 'FencedCode') {
        for (let p = node.from; p <= node.to; ) {
          const line = state.doc.lineAt(p);
          out.push({ from: line.from, to: line.from, kind: 'line', lineClass: 'cm-md-codeline' });
          if (line.to >= node.to) break;
          p = line.to + 1;
        }
        return;
      }

      if (STYLED[name]) {
        out.push({ from: node.from, to: node.to, kind: STYLED[name]! });
        return;
      }

      if (name === 'Link') {
        out.push({ from: node.from, to: node.to, kind: 'link' });
        return;
      }

      // The target of a link is noise once the label reads as a link. It comes back with
      // the rest of the syntax when the cursor is on that line.
      if (name === 'URL' && !onActiveLine(node.from)) {
        out.push({ from: node.from, to: node.to, kind: 'hide' });
        return;
      }

      const heading = /^ATXHeading(\d)$/.exec(name);
      if (heading) {
        out.push({ from: node.from, to: node.to, kind: 'heading', level: Number(heading[1]) });
        return;
      }

      // A bullet becomes a real bullet. Ordered markers are left as they are: "1." is
      // the number, and hiding it would leave the reader guessing at the sequence.
      if (name === 'ListMark' && !onActiveLine(node.from)) {
        const isBullet = /^[-*+]$/.test(state.doc.sliceString(node.from, node.to));
        if (isBullet) {
          // A checklist item carries both a bullet and a box. Showing "• ☐" twice over is
          // noise, so the bullet gives way to the box.
          const item = node.node.parent;
          const hasTask = item?.name === 'ListItem' && !!item.getChild('Task');
          const to = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
          out.push({ from: node.from, to, kind: hasTask ? 'hide' : 'bullet' });
        }
        return;
      }

      if (name === 'TaskMarker' && !onActiveLine(node.from)) {
        const raw = state.doc.sliceString(node.from, node.to);
        const to = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
        out.push({ from: node.from, to, kind: 'checkbox', checked: /x/i.test(raw) });
        return;
      }

      if (name === 'CodeMark' && node.node.parent?.name === 'FencedCode') return;

      if (HIDDEN_MARKS.has(name) && !onActiveLine(node.from)) {
        // A line marker takes its trailing space with it, or the text it introduces stays
        // indented by one column and the paragraph does not line up with its neighbours.
        const takesSpace = name === 'HeaderMark' || name === 'QuoteMark';
        const to =
          takesSpace && state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
        out.push({ from: node.from, to, kind: 'hide' });
      }
    },
  });

  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The bullet standing in for `-`. Decoration only; nothing to click. */
class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '\u2022\u2003';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

/**
 * A checkbox you can actually tick.
 *
 * Clicking rewrites the three characters of the marker in the document, which is the same
 * edit typing the x would make — so it goes through undo, through the save, and onto disk
 * as those three bytes and nothing else. `ignoreEvent` returning true is what stops
 * CodeMirror treating the click as a click into text and swallowing it.
 */
class CheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly at: number,
  ) {
    super();
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('span');
    box.className = this.checked ? 'cm-md-box on' : 'cm-md-box';
    box.textContent = this.checked ? '\u2611\u2003' : '\u2610\u2003';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.tabIndex = 0;

    const toggle = () => {
      // Re-read rather than trusting the position this widget was built with: the document
      // may have moved on since, and rewriting the wrong three characters would be worse
      // than doing nothing.
      const here = view.state.doc.sliceString(this.at, this.at + 3);
      if (!/^\[[ xX]\]$/.test(here)) return;
      view.dispatch({
        changes: { from: this.at, to: this.at + 3, insert: /x/i.test(here) ? '[ ]' : '[x]' },
      });
    };

    box.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus and the selection where they were
      toggle();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle();
      }
    });
    return box;
  }
  override ignoreEvent() {
    return true;
  }
}

const BULLET = Decoration.replace({ widget: new BulletWidget() });

const MARK = {
  strong: Decoration.mark({ class: 'cm-md-strong' }),
  em: Decoration.mark({ class: 'cm-md-em' }),
  strike: Decoration.mark({ class: 'cm-md-strike' }),
  code: Decoration.mark({ class: 'cm-md-code' }),
  link: Decoration.mark({ class: 'cm-md-link' }),
  url: Decoration.mark({ class: 'cm-md-url' }),
  quote: Decoration.mark({ class: 'cm-md-quote' }),
};
const HIDE = Decoration.replace({});

function build(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of previewRanges(state)) {
    if (r.kind === 'line') {
      // Line decorations are zero-length by definition — they attach to a line rather
      // than cover any text — so they must be added before the empty-range guard below,
      // which would otherwise drop every one of them.
      builder.add(
        r.from,
        r.from,
        Decoration.line({
          class: r.lineClass!,
          ...(r.style ? { attributes: { style: r.style } } : {}),
        }),
      );
      continue;
    }
    if (r.from === r.to) continue;
    if (r.kind === 'hide') builder.add(r.from, r.to, HIDE);
    else if (r.kind === 'bullet') builder.add(r.from, r.to, BULLET);
    else if (r.kind === 'checkbox') {
      builder.add(
        r.from,
        r.to,
        Decoration.replace({ widget: new CheckboxWidget(!!r.checked, r.from) }),
      );
    } else if (r.kind === 'heading') {
      builder.add(r.from, r.to, Decoration.mark({ class: `cm-md-h${r.level ?? 1}` }));
    } else builder.add(r.from, r.to, MARK[r.kind]);
  }
  return builder.finish();
}

/**
 * Live preview. Rebuilt on every document *and* selection change — the selection matters
 * because moving the cursor onto a line is what brings its syntax back.
 */
export function livePreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view.state);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = build(update.state);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
