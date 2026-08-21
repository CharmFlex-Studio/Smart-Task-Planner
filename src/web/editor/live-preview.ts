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
    | 'checkbox';
  /** Heading level, when kind is 'heading'. */
  level?: number;
  /** Whether the box is ticked, when kind is 'checkbox'. */
  checked?: boolean;
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

  syntaxTree(state).iterate({
    enter(node) {
      const name = node.name;

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

      if (name === 'Blockquote') {
        out.push({ from: node.from, to: node.to, kind: 'quote' });
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

/**
 * A glyph standing in for markup. Not an input: this is an editor, and a control that
 * swallows clicks inside editable text is a worse trade than typing the x yourself. The
 * reading view is where boxes are clickable.
 */
class GlyphWidget extends WidgetType {
  constructor(
    private readonly glyph: string,
    private readonly cls: string,
  ) {
    super();
  }
  override eq(other: GlyphWidget) {
    return other.glyph === this.glyph && other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.cls;
    span.textContent = this.glyph;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  override ignoreEvent() {
    return false;
  }
}

const BULLET = Decoration.replace({ widget: new GlyphWidget('•\u2003', 'cm-md-bullet') });
const BOX_OFF = Decoration.replace({ widget: new GlyphWidget('\u2610\u2003', 'cm-md-box') });
const BOX_ON = Decoration.replace({ widget: new GlyphWidget('\u2611\u2003', 'cm-md-box on') });

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
    if (r.from === r.to) continue;
    if (r.kind === 'hide') builder.add(r.from, r.to, HIDE);
    else if (r.kind === 'bullet') builder.add(r.from, r.to, BULLET);
    else if (r.kind === 'checkbox') builder.add(r.from, r.to, r.checked ? BOX_ON : BOX_OFF);
    else if (r.kind === 'heading') {
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
