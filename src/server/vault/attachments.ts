/**
 * Files attached to a task: naming, typing, and what may be shown inline.
 *
 * Attachments are ordinary files in the workspace's own `attachments/` folder, linked
 * from the markdown with ordinary markdown. That is what keeps rule 1 true — open the
 * vault in Obsidian or Finder and the images are simply there, next to the notes that
 * reference them. Nothing is stored anywhere the files cannot reconstruct.
 *
 * The pure parts live here so the rules that matter — what a filename may become, and
 * what may be served inline — are testable without touching a disk.
 */

import path from 'node:path';

export const ATTACHMENTS_DIR = 'attachments';

/** 25 MB. Large enough for a screenshot or a PDF, small enough not to bloat a vault. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Only these are ever served inline, with their real type. Everything else is sent as a
 * download.
 *
 * The list is deliberately short. An uploaded `.html` served inline from this origin
 * would be running in the same place as the app, able to read its storage and call its
 * API — and a vault can be shared, synced, or written by something that is not the person
 * reading it. SVG is left out for the same reason: it is a document that can carry script,
 * not just a picture.
 */
const INLINE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

export function inlineTypeFor(name: string): string | null {
  return INLINE_TYPES[path.extname(name).toLowerCase()] ?? null;
}

/** Whether this attachment should be embedded with `![]()` rather than linked. */
export function isEmbeddable(name: string): boolean {
  return inlineTypeFor(name) !== null;
}

/**
 * Reduce whatever the browser handed us to a filename that cannot escape the folder or
 * surprise a filesystem.
 *
 * Anything with a path in it keeps only its last segment, so `../../.ssh/id_rsa` becomes
 * `id_rsa`. A name that reduces to nothing gets one, because refusing an upload over a
 * filename is a worse outcome than renaming it.
 */
export function safeAttachmentName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const rawExt = path.extname(base);
  const stem = base
    .slice(0, base.length - rawExt.length)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60);

  // Judged whole, never truncated: shortening `.averylongextension` to `.averylongex`
  // would leave a name claiming to be a type it is not. An extension that is not a
  // plausible one is dropped, and the file keeps its bytes either way.
  const ext = rawExt.toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
  return (stem || 'attachment') + safeExt;
}

/**
 * A name not already taken, by adding `-1`, `-2` and so on.
 *
 * Never overwrites. Two screenshots pasted a minute apart are both called
 * `screenshot.png`, and losing the first to the second would be silent data loss.
 */
export function uniqueAttachmentName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * The absolute path of an attachment, or null when the name tries to leave the folder.
 *
 * Checked after resolution rather than by inspecting the string, because that is the only
 * form of the question a filesystem actually answers.
 */
export function resolveAttachment(dir: string, name: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0')) return null;
  const resolved = path.resolve(dir, decoded);
  const root = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

/** The markdown that references an attachment: an embed for images, a link otherwise. */
export function attachmentMarkdown(name: string): string {
  const href = `${ATTACHMENTS_DIR}/${encodeURIComponent(name)}`;
  return isEmbeddable(name) ? `![${name}](${href})` : `[${name}](${href})`;
}
