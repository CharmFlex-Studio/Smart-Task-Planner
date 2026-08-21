/**
 * Getting a file into the editor: pasted, dropped, or chosen.
 *
 * All three end the same way — the file is uploaded into the workspace's attachments
 * folder and a plain markdown link to it is inserted at the cursor. The markdown is what
 * the server hands back, so the UI never has to decide whether something is an image.
 */

import type { EditorView } from '@codemirror/view';
import { api } from '../api.js';

/**
 * What to pad an insertion with so it lands as its own block.
 *
 * An embedded image dropped into the middle of a sentence reads as part of that sentence,
 * which is almost never what someone attaching a screenshot meant. A *link* to a file is
 * different — putting one mid-sentence is completely normal — so only embeds get this.
 *
 * Pure, so the awkward positions (start of the document, already on a blank line, end of
 * a paragraph) are testable without an editor.
 */
export function blockPadding(doc: string, at: number): { before: string; after: string } {
  const beforeText = doc.slice(0, at);
  const afterText = doc.slice(at);

  let before = '';
  if (beforeText.length > 0) {
    if (!beforeText.endsWith('\n')) before = '\n\n';
    else if (!beforeText.endsWith('\n\n')) before = '\n';
  }

  let after = '';
  if (afterText.length > 0) {
    if (!afterText.startsWith('\n')) after = '\n\n';
    else if (!afterText.startsWith('\n\n')) after = '\n';
  }
  return { before, after };
}

/** Insert text at the cursor, replacing whatever is selected. */
export function insertAtCursor(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

/** An embed goes on its own line; a link goes wherever the cursor is. */
function withPadding(view: EditorView, markdown: string): string {
  if (!markdown.startsWith('!')) return markdown;
  const { before, after } = blockPadding(
    view.state.doc.toString(),
    view.state.selection.main.from,
  );
  return before + markdown + after;
}

/**
 * Upload files and drop their markdown in, one after another.
 *
 * A placeholder goes in first and is replaced when the upload lands, so a large paste
 * does not look like nothing happened — and if it fails the placeholder is taken back
 * out rather than left behind pointing at a file that does not exist.
 */
export async function attachFiles(
  view: EditorView,
  files: readonly File[],
  onError: (message: string) => void,
): Promise<void> {
  for (const file of files) {
    const placeholder = withPadding(view, `![uploading ${file.name}…]()`);
    const at = view.state.selection.main.from;
    insertAtCursor(view, placeholder);

    try {
      const { attachment } = await api.uploadAttachment(file);
      const current = view.state.doc.toString();
      const found = current.indexOf(placeholder, Math.max(0, at - placeholder.length));
      if (found >= 0) {
        // The placeholder already carries the padding, so keep it and swap only the
        // markdown inside — recomputing it here would double the blank lines.
        const inner = placeholder.trim();
        const replacement = placeholder.replace(inner, attachment.markdown);
        view.dispatch({
          changes: { from: found, to: found + placeholder.length, insert: replacement },
          selection: { anchor: found + replacement.length },
        });
      } else {
        insertAtCursor(view, attachment.markdown);
      }
    } catch (err) {
      const current = view.state.doc.toString();
      const found = current.indexOf(placeholder);
      if (found >= 0) {
        view.dispatch({ changes: { from: found, to: found + placeholder.length, insert: '' } });
      }
      onError(err instanceof Error ? err.message : `Could not attach ${file.name}.`);
    }
  }
}

/** Files carried by a paste or a drop, if there are any. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []);
}
