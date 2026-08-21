/**
 * Saving and reading attached files.
 *
 * UI-only, like lanes and comments, and absent from the model's schema on purpose: the
 * assistant writes text, and giving it a way to put arbitrary bytes into someone's vault
 * buys nothing and costs a whole category of things that can go wrong.
 *
 * Files land in the workspace's own `attachments/` folder and are referenced from the
 * markdown by an ordinary relative link, so the vault stays a folder that explains itself
 * — open it in Obsidian and the images are where the notes say they are.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { VaultStore } from '../vault/store.js';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentMarkdown,
  inlineTypeFor,
  resolveAttachment,
  safeAttachmentName,
  uniqueAttachmentName,
} from '../vault/attachments.js';
import { ToolError } from './errors.js';

export interface SavedAttachment {
  name: string;
  /** Path relative to the workspace folder, which is what goes in the markdown. */
  href: string;
  bytes: number;
  /** The markdown to insert: an embed for an image, a link for anything else. */
  markdown: string;
}

export class AttachmentTools {
  constructor(private readonly store: VaultStore) {}

  async save(originalName: string, data: Uint8Array): Promise<SavedAttachment> {
    if (data.byteLength === 0) {
      throw new ToolError('invalid', 'That file is empty.');
    }
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      const mb = Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024);
      throw new ToolError(
        'invalid',
        `That file is larger than ${mb} MB.`,
        'Attachments live in your vault, so a big one is a big vault.',
      );
    }

    const dir = this.store.attachmentsDir;
    await fs.mkdir(dir, { recursive: true });

    const existing = new Set(await fs.readdir(dir).catch(() => []));
    const name = uniqueAttachmentName(safeAttachmentName(originalName), (n) => existing.has(n));

    const target = resolveAttachment(dir, name);
    // Cannot happen with a sanitised name, and is checked anyway: this is the last point
    // before bytes hit a path, and the cost of being wrong here is writing outside the vault.
    if (!target) throw new ToolError('invalid', `"${originalName}" is not a usable filename.`);

    // wx: never clobber. The unique name should have settled it, but two uploads racing
    // would both have read the same listing.
    await fs.writeFile(target, data, { flag: 'wx' });

    return {
      name,
      href: `attachments/${encodeURIComponent(name)}`,
      bytes: data.byteLength,
      markdown: attachmentMarkdown(name),
    };
  }

  /**
   * Read one attachment for serving.
   *
   * `inline` is only ever true for the image types on the safelist. Everything else is
   * handed back for the caller to send as a download, because serving an arbitrary
   * uploaded file inline from this origin is how an attachment becomes a script running
   * where the app runs.
   */
  async read(
    name: string,
  ): Promise<{ body: Uint8Array<ArrayBuffer>; type: string; inline: boolean } | null> {
    const target = resolveAttachment(this.store.attachmentsDir, name);
    if (!target) return null;
    try {
      const raw = await fs.readFile(target);
      const body = new Uint8Array(raw.byteLength);
      body.set(raw);
      const inlineType = inlineTypeFor(target);
      return {
        body,
        type: inlineType ?? 'application/octet-stream',
        inline: inlineType !== null,
      };
    } catch {
      return null;
    }
  }

  /** Every attachment this workspace holds, newest first. */
  async list(): Promise<{ name: string; bytes: number }[]> {
    const dir = this.store.attachmentsDir;
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const out: { name: string; bytes: number; at: number }[] = [];
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const stat = await fs.stat(path.join(dir, name)).catch(() => null);
      if (stat?.isFile()) out.push({ name, bytes: stat.size, at: stat.mtimeMs });
    }
    return out.sort((a, b) => b.at - a.at).map(({ name, bytes }) => ({ name, bytes }));
  }
}
