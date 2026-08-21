/**
 * A textarea that knows what markdown is.
 *
 * Not a rich-text editor. It stays a textarea on purpose: the file on disk is the truth,
 * and an editor that reformats a whole block on save would quietly rewrite spacing,
 * comments and frontmatter someone put there by hand. The toolbar and the shortcuts only
 * ever insert the characters you would have typed yourself, so what is saved is what you
 * can see.
 */

import React, { useCallback, useRef } from 'react';
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
  {
    code: 'KeyB',
    shift: false,
    label: 'B',
    title: 'Bold  ⌘B',
    run: (v, s) => applyWrap(v, s, '**', 'bold text'),
  },
  {
    code: 'KeyI',
    shift: false,
    label: 'I',
    title: 'Italic  ⌘I',
    run: (v, s) => applyWrap(v, s, '*', 'italic text'),
  },
  {
    code: 'KeyE',
    shift: false,
    label: '</>',
    title: 'Code  ⌘E',
    run: (v, s) => applyWrap(v, s, '`', 'code'),
  },
  {
    code: 'KeyK',
    shift: false,
    label: '🔗',
    title: 'Link  ⌘K',
    run: (v, s) => applyWrap(v, s, ['[', '](https://)'], 'label'),
  },
  {
    code: 'Digit8',
    shift: true,
    label: '•',
    title: 'Bullet list  ⌘⇧8',
    run: (v, s) => applyLinePrefix(v, s, '- '),
  },
  {
    code: 'Digit7',
    shift: true,
    label: '1.',
    title: 'Numbered list  ⌘⇧7',
    run: (v, s) => applyLinePrefix(v, s, '1. '),
  },
  {
    code: 'KeyL',
    shift: true,
    label: '☑',
    title: 'Checklist  ⌘⇧L',
    run: (v, s) => applyLinePrefix(v, s, '- [ ] '),
  },
  {
    code: 'Period',
    shift: true,
    label: '❝',
    title: 'Quote  ⌘⇧.',
    run: (v, s) => applyLinePrefix(v, s, '> '),
  },
];

export function MarkdownEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  ariaLabel,
  rows,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  ariaLabel: string;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const run = useCallback(
    (action: Action) => {
      const el = ref.current;
      if (!el) return;
      const sel: Selection = { start: el.selectionStart, end: el.selectionEnd };
      const next = action.run(value, sel);
      onChange(next.value);
      // Put the caret where the writer expects it, after React has painted the new value.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.selection.start, next.selection.end);
      });
    },
    [value, onChange],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    if (event.key === 'Enter' && onCommit) {
      event.preventDefault();
      onCommit();
      return;
    }
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
            // Keep the textarea's selection: a mousedown that moves focus would collapse it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(a)}
          >
            {a.label}
          </button>
        ))}
        <span className="md-hint">markdown</span>
      </div>
      <textarea
        ref={ref}
        value={value}
        rows={rows ?? Math.max(4, value.split('\n').length + 1)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
