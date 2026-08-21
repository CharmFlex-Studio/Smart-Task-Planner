/**
 * Following a link from inside the editor.
 *
 * Cmd-click (Ctrl on Windows and Linux) rather than a plain click, which is the
 * convention everywhere text is both editable and linked: a plain click has to keep
 * meaning "put the caret here", or the text under a link becomes unreachable.
 *
 * The URL goes through the same validator the reading view uses, so a `javascript:` link
 * written into a task file is as inert here as it is there.
 */

import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { openExternally, safeUrl } from '../safe-url.js';

/**
 * The URL of the markdown link covering `pos`, if there is one.
 *
 * Exported so the interesting part — finding the right link, and refusing the wrong
 * scheme — is testable without a browser.
 */
export function linkAt(state: EditorState, pos: number): string | null {
  let found: string | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(node) {
      if (node.name !== 'Link') return;
      const url = node.node.getChild('URL');
      if (!url) return;
      found = safeUrl(state.doc.sliceString(url.from, url.to));
    },
  });
  return found;
}

export function linkClicking() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const url = linkAt(view.state, pos);
      if (!url) return false;
      event.preventDefault();
      openExternally(url);
      return true;
    },
  });
}
