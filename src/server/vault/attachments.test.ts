import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  safeAttachmentName,
  uniqueAttachmentName,
  resolveAttachment,
  inlineTypeFor,
  isEmbeddable,
  attachmentMarkdown,
} from './attachments.js';

describe('safeAttachmentName', () => {
  it('keeps an ordinary name as it is', () => {
    expect(safeAttachmentName('screenshot.png')).toBe('screenshot.png');
    expect(safeAttachmentName('Q3-report_final.pdf')).toBe('Q3-report_final.pdf');
  });

  it('throws away any path, so an upload cannot choose where it lands', () => {
    expect(safeAttachmentName('../../.ssh/id_rsa')).toBe('id_rsa');
    expect(safeAttachmentName('/etc/passwd')).toBe('passwd');
    expect(safeAttachmentName('C:\\Windows\\system32\\evil.dll')).toBe('evil.dll');
  });

  it('replaces characters a filesystem would argue about', () => {
    expect(safeAttachmentName('my report (final).pdf')).toBe('my-report-final.pdf');
    expect(safeAttachmentName('a:b*c?d.png')).toBe('a-b-c-d.png');
  });

  it('gives a name to something that has none left', () => {
    expect(safeAttachmentName('...')).toBe('attachment');
    expect(safeAttachmentName('')).toBe('attachment');
    expect(safeAttachmentName('///')).toBe('attachment');
  });

  it('does not leave a leading dot, which would make it a hidden file', () => {
    expect(safeAttachmentName('.env').startsWith('.')).toBe(false);
    expect(safeAttachmentName('.hidden.png').startsWith('.')).toBe(false);
  });

  it('keeps the extension, lowercased, and drops an absurd one', () => {
    expect(safeAttachmentName('IMAGE.PNG')).toBe('IMAGE.png');
    expect(safeAttachmentName('file.' + 'x'.repeat(40))).toBe('file');
  });

  it('shortens a very long name rather than refusing it', () => {
    const out = safeAttachmentName('a'.repeat(300) + '.png');
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.endsWith('.png')).toBe(true);
  });
});

describe('uniqueAttachmentName', () => {
  it('leaves a free name alone', () => {
    expect(uniqueAttachmentName('a.png', () => false)).toBe('a.png');
  });

  it('never overwrites — two pasted screenshots both survive', () => {
    const used = new Set(['screenshot.png']);
    expect(uniqueAttachmentName('screenshot.png', (n) => used.has(n))).toBe('screenshot-1.png');
  });

  it('counts past several collisions', () => {
    const used = new Set(['a.png', 'a-1.png', 'a-2.png']);
    expect(uniqueAttachmentName('a.png', (n) => used.has(n))).toBe('a-3.png');
  });

  it('puts the number before the extension, not after it', () => {
    const used = new Set(['report.pdf']);
    expect(uniqueAttachmentName('report.pdf', (n) => used.has(n))).toBe('report-1.pdf');
  });
});

describe('resolveAttachment', () => {
  const dir = path.resolve('/vault/main/attachments');

  it('resolves a plain name inside the folder', () => {
    expect(resolveAttachment(dir, 'a.png')).toBe(path.join(dir, 'a.png'));
  });

  it('refuses anything that climbs out', () => {
    expect(resolveAttachment(dir, '../../../etc/passwd')).toBeNull();
    expect(resolveAttachment(dir, '..%2F..%2Fpasswd')).toBeNull();
    expect(resolveAttachment(dir, '/etc/passwd')).toBeNull();
  });

  it('refuses a sibling folder that merely shares the prefix', () => {
    expect(resolveAttachment(dir, '../attachments-other/x.png')).toBeNull();
  });

  it('refuses malformed encoding, empties and null bytes', () => {
    expect(resolveAttachment(dir, '%ZZ')).toBeNull();
    expect(resolveAttachment(dir, '')).toBeNull();
    expect(resolveAttachment(dir, 'a\0.png')).toBeNull();
  });

  it('decodes a name that was percent-encoded in the link', () => {
    expect(resolveAttachment(dir, 'my%20file.png')).toBe(path.join(dir, 'my file.png'));
  });
});

/**
 * The safelist is a security boundary, not a convenience. An uploaded .html served inline
 * from this origin would run where the app runs; a vault can be shared or synced, so its
 * contents are not necessarily written by the person reading them.
 */
describe('what may be served inline', () => {
  it('allows the ordinary raster images', () => {
    expect(inlineTypeFor('a.png')).toBe('image/png');
    expect(inlineTypeFor('a.JPG')).toBe('image/jpeg');
    expect(inlineTypeFor('a.webp')).toBe('image/webp');
  });

  it('refuses html, so an attachment cannot run in the app\'s own origin', () => {
    expect(inlineTypeFor('page.html')).toBeNull();
    expect(inlineTypeFor('page.htm')).toBeNull();
  });

  it('refuses svg, which is a document that can carry script', () => {
    expect(inlineTypeFor('logo.svg')).toBeNull();
  });

  it('refuses everything else, which is downloaded instead', () => {
    expect(inlineTypeFor('report.pdf')).toBeNull();
    expect(inlineTypeFor('notes.txt')).toBeNull();
    expect(inlineTypeFor('no-extension')).toBeNull();
  });
});

describe('attachmentMarkdown', () => {
  it('embeds an image', () => {
    expect(attachmentMarkdown('shot.png')).toBe('![shot.png](attachments/shot.png)');
  });

  it('links anything else', () => {
    expect(attachmentMarkdown('report.pdf')).toBe('[report.pdf](attachments/report.pdf)');
    expect(isEmbeddable('report.pdf')).toBe(false);
  });

  it('encodes a space so the link does not break', () => {
    expect(attachmentMarkdown('my file.png')).toBe('![my file.png](attachments/my%20file.png)');
  });
});
