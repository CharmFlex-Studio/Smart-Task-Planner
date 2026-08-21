/**
 * The editor for a description or a comment.
 *
 * CodeMirror rather than a textarea, for one reason: a textarea cannot hide a character,
 * and hiding the markers is the whole point of live preview. What it is NOT is a
 * rich-text editor — the document held here is the markdown text and nothing else, and
 * every effect on screen is a decoration over it. Nothing normalises the buffer, so what
 * is saved is what was typed, which is what lets the file on disk stay the truth.
 *
 * The toolbar still works on the text, through the same pure helpers the textarea used.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { livePreview } from '../editor/live-preview.js';
import { continuation, shiftIndent } from '../editor/list-commands.js';
import { editorTheme } from '../editor/theme.js';
import { applyWrap, applyLinePrefix, type Selection } from '../markdown-edit.js';

interface Action {
  /** KeyboardEvent.code, not .key: layout-independent, and ⌘⇧8 arrives as "*" on US. */
  code: string;
  shift: boolean;
  label: string;
  title: string;
  run: (value: string, sel: Selection) => { value: string; selection: Selection };
}

const ACTIONS: Action[] = [
  { code: 'KeyB', shift: false, label: 'B', title: 'Bold  ⌘B', run: (v, s) => applyWrap(v, s, '**', 'bold text') },
  { code: 'KeyI', shift: false, label: 'I', title: 'Italic  ⌘I', run: (v, s) => applyWrap(v, s, '*', 'italic text') },
  { code: 'KeyE', shift: false, label: '</>', title: 'Code  ⌘E', run: (v, s) => applyWrap(v, s, '`', 'code') },
  { code: 'KeyK', shift: false, label: '🔗', title: 'Link  ⌘K', run: (v, s) => applyWrap(v, s, ['[', '](https://)'], 'label') },
  { code: 'Digit8', shift: true, label: '•', title: 'Bullet list  ⌘⇧8', run: (v, s) => applyLinePrefix(v, s, '- ') },
  { code: 'Digit7', shift: true, label: '1.', title: 'Numbered list  ⌘⇧7', run: (v, s) => applyLinePrefix(v, s, '1. ') },
  { code: 'KeyL', shift: true, label: '☑', title: 'Checklist  ⌘⇧L', run: (v, s) => applyLinePrefix(v, s, '- [ ] ') },
  { code: 'Period', shift: true, label: '❝', title: 'Quote  ⌘⇧.', run: (v, s) => applyLinePrefix(v, s, '> ') },
];

export function MarkdownEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  ariaLabel,
  minHeight,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  ariaLabel: string;
  minHeight?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Held in refs so the extensions built once below always call the current ones, rather
  // than closing over the first render's props.
  const latest = useRef({ onChange, onCommit, onCancel });
  useEffect(() => {
    latest.current = { onChange, onCommit, onCancel };
  });

  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      history(),
      keymap.of([
        {
          // Enter carries a list on, and a second Enter on an empty item ends it —
          // which is how everyone leaves a list.
          key: 'Enter',
          run: (v) => {
            const { from, to } = v.state.selection.main;
            if (from !== to) return false;
            const line = v.state.doc.lineAt(from);
            const next = continuation(line.text);
            if (!next) return false;
            if ('clearLine' in next) {
              v.dispatch({
                changes: { from: line.from, to: line.to, insert: '' },
                selection: { anchor: line.from },
              });
              return true;
            }
            v.dispatch({
              changes: { from, to, insert: next.insert },
              selection: { anchor: from + next.insert.length },
              scrollIntoView: true,
            });
            return true;
          },
        },
        {
          key: 'Tab',
          run: (v) => {
            const line = v.state.doc.lineAt(v.state.selection.main.head);
            const shifted = shiftIndent(line.text, 1);
            if (shifted === null) return false;
            v.dispatch({ changes: { from: line.from, to: line.to, insert: shifted } });
            return true;
          },
        },
        {
          key: 'Shift-Tab',
          run: (v) => {
            const line = v.state.doc.lineAt(v.state.selection.main.head);
            const shifted = shiftIndent(line.text, -1);
            if (shifted === null) return false;
            v.dispatch({ changes: { from: line.from, to: line.to, insert: shifted } });
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            latest.current.onCommit?.();
            return !!latest.current.onCommit;
          },
        },
        {
          key: 'Escape',
          run: () => {
            latest.current.onCancel?.();
            return !!latest.current.onCancel;
          },
        },
        ...historyKeymap,
        // Filtered so the editor keeps Mod-Enter and Escape for saving and cancelling.
        ...defaultKeymap.filter((b) => b.key !== 'Mod-Enter' && b.key !== 'Escape'),
      ]),
      markdown({ base: markdownLanguage }),
      livePreview(),
      editorTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) latest.current.onChange(u.state.doc.toString());
      }),
      EditorState.allowMultipleSelections.of(false),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
    ];

    const v = new EditorView({
      state: EditorState.create({
        doc: value,
        // Land at the end, not the top. Focusing line 1 would reveal that line's markers
        // the instant the editor opens, which is the worst possible first impression of
        // something whose whole point is hiding them.
        selection: { anchor: value.length },
        extensions,
      }),
      parent: host.current,
    });
    view.current = v;
    if (autoFocus) v.focus();

    return () => {
      v.destroy();
      view.current = null;
    };
    // Built once for the life of the component; `value` is synced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Take in a value changed from outside — a different task opened, or the composer
  // cleared after posting. Never echo back what the editor itself just produced, which
  // would fight the cursor on every keystroke.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    v.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(v.state.selection.main.anchor, value.length) },
    });
  }, [value]);

  const run = useCallback((action: Action) => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc.toString();
    const { from, to } = v.state.selection.main;
    const next = action.run(doc, { start: from, end: to });
    v.dispatch({
      changes: { from: 0, to: doc.length, insert: next.value },
      selection: { anchor: next.selection.start, head: next.selection.end },
    });
    v.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const action = ACTIONS.find((a) => a.code === event.code && a.shift === event.shiftKey);
    if (action) {
      event.preventDefault();
      run(action);
    }
  };

  return (
    <div className="md-editor">
      <div className="md-toolbar" role="toolbar" aria-label="Formatting">
        {ACTIONS.map((a) => (
          <button
            key={a.code}
            type="button"
            className="md-tool"
            title={a.title}
            aria-label={a.title}
            // Keep the editor's selection: a mousedown that moves focus would collapse it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(a)}
          >
            {a.label}
          </button>
        ))}
        <span className="md-hint">live markdown</span>
      </div>
      <div
        ref={host}
        className="md-surface"
        style={minHeight ? { minHeight } : undefined}
        onKeyDown={onKeyDown}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
      />
    </div>
  );
}
