/**
 * What the assistant is allowed to make of an attached file.
 *
 * Three outcomes, and the distinction is the whole point: a text file becomes text the
 * model reads; an image becomes an image the model may or may not be able to see; and
 * anything else is refused with a plain statement of what it is, rather than a wall of
 * mojibake that eats the context window and teaches the model nothing.
 *
 * The classification is pure so the boundaries are testable without a disk or a model.
 */

import path from 'node:path';

/**
 * Roughly 6k of text, which is a few thousand tokens.
 *
 * A budget rather than the whole file: a 2 MB log pasted into a small model's context
 * pushes out the task list, the board and the conversation, and the answer gets worse the
 * more you gave it.
 */
export const MAX_TEXT_CHARS = 6_000;

/** Extensions read as text. Everything here is something a person would open in an editor. */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.json', '.yml', '.yaml',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.sql', '.html', '.htm', '.xml', '.svg',
  '.css', '.scss', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go',
  '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.sh', '.bash', '.zsh', '.diff', '.patch',
]);

/** Images the model can be shown, when it is one that can see. */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export type AttachmentKind =
  | { kind: 'text' }
  | { kind: 'image'; mediaType: string }
  | { kind: 'other' };

export function classifyAttachment(name: string): AttachmentKind {
  const ext = path.extname(name).toLowerCase();
  const image = IMAGE_TYPES[ext];
  if (image) return { kind: 'image', mediaType: image };
  if (TEXT_EXTENSIONS.has(ext)) return { kind: 'text' };
  return { kind: 'other' };
}

/**
 * Bytes to text, if they really are text.
 *
 * The extension is a claim, not a fact — a `.csv` can hold anything. A NUL byte in the
 * first stretch means binary, whatever it is called, and decoding it would produce
 * nonsense the model would then try to reason about.
 */
export function decodeText(bytes: Uint8Array): string | null {
  const probe = bytes.subarray(0, 1024);
  if (probe.includes(0)) return null;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // U+FFFD in quantity means it was not UTF-8 to begin with.
  const replacements = (text.match(/�/g) ?? []).length;
  if (replacements > Math.max(4, text.length * 0.01)) return null;
  return text;
}

/** Cut to the budget, saying so, so the model knows it is not seeing all of it. */
export function clampText(text: string, name: string, limit = MAX_TEXT_CHARS): string {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) +
    `\n\n[...${name} continues for ${text.length - limit} more characters, not shown.]`
  );
}

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
