/**
 * How the editor looks. Every colour comes from the app's own CSS variables, so the
 * editor follows the theme rather than carrying a second palette that drifts from it.
 */

import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: '0.95rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily: 'var(--sans)',
    padding: '0.55rem 0.7rem',
    lineHeight: '1.6',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0 2px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-placeholder': { color: 'var(--faint)' },
  '.cm-scroller': { fontFamily: 'var(--sans)', overflow: 'auto' },

  // --- what live preview draws -------------------------------------------------
  '.cm-md-strong': { fontWeight: '600', color: 'var(--text)' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', color: 'var(--faint)' },
  '.cm-md-code': {
    fontFamily: 'var(--mono)',
    fontSize: '0.88em',
    background: 'var(--panel-2)',
    border: '1px solid var(--line)',
    borderRadius: '4px',
    padding: '0.05em 0.3em',
  },
  '.cm-md-link': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  // Only a modifier-click follows a link, so only then does it look followable.
  '.cm-md-link:hover': { textDecorationThickness: '2px' },
  '.cm-md-quote': { color: 'var(--muted)', fontStyle: 'italic' },
  '.cm-md-h1': { fontSize: '1.3em', fontWeight: '600' },
  '.cm-md-h2': { fontSize: '1.18em', fontWeight: '600' },
  '.cm-md-h3': { fontSize: '1.08em', fontWeight: '600' },
  '.cm-md-h4': { fontSize: '1em', fontWeight: '600' },
  '.cm-md-h5': { fontSize: '1em', fontWeight: '600' },
  '.cm-md-h6': { fontSize: '1em', fontWeight: '600', color: 'var(--muted)' },
  '.cm-md-bullet': { color: 'var(--faint)' },

  // The box is a control, so it has to look and behave like one.
  '.cm-md-box': { color: 'var(--faint)', cursor: 'pointer', borderRadius: '3px' },
  '.cm-md-box.on': { color: 'var(--accent)' },
  '.cm-md-box:hover': { color: 'var(--accent)' },
  '.cm-md-box:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },

  // Wrapped rows of a list item hang under its text; the indent itself is per-line.
  '.cm-md-listline': {},
  '.cm-md-quoteline': {
    borderLeft: '2px solid var(--accent-line)',
    paddingLeft: '0.7em',
    marginLeft: '0.1em',
  },
  '.cm-md-codeline': {
    fontFamily: 'var(--mono)',
    fontSize: '0.85em',
    background: 'var(--panel-2)',
    paddingLeft: '0.6em',
    paddingRight: '0.6em',
  },
});
