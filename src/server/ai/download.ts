import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export interface Progress {
  received: number;
  total: number;
  /** 0..1, or undefined when the server did not send a content-length. */
  fraction?: number;
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * Download to a temp file beside the destination, then rename into place.
 *
 * The rename is the commit point: a half-finished download can never be mistaken for an
 * installed model, however the process died. Cancellation and failure both clean up.
 */
export async function downloadFile(
  url: string,
  destination: string,
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: Progress) => void;
    expectedSha256?: string;
  } = {},
): Promise<{ bytes: number; sha256: string; verified: boolean }> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const tmp = `${destination}.${randomBytes(6).toString('hex')}.part`;

  let response: Response;
  try {
    response = await fetch(url, { signal: opts.signal, redirect: 'follow' });
  } catch (err) {
    throw new DownloadError(
      `Could not reach the download server.`,
      `${(err as Error).message}. This is the one time the planner uses the network; check your connection.`,
    );
  }
  if (!response.ok || !response.body) {
    throw new DownloadError(
      `Download failed with HTTP ${response.status}.`,
      response.status === 403 || response.status === 401
        ? 'That URL needs authentication or licence acceptance, so it cannot be part of a one-click install. Pick an ungated source.'
        : `URL: ${url}`,
    );
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const hash = createHash('sha256');
  let received = 0;

  const handle = await fs.open(tmp, 'w');
  try {
    for await (const chunk of streamOf(response.body)) {
      if (opts.signal?.aborted) throw new DownloadError('Download cancelled.');
      hash.update(chunk);
      received += chunk.byteLength;
      await handle.write(chunk);
      opts.onProgress?.({
        received,
        total,
        ...(total > 0 ? { fraction: Math.min(1, received / total) } : {}),
      });
    }
  } catch (err) {
    await handle.close();
    await fs.rm(tmp, { force: true });
    throw err instanceof DownloadError ? err : new DownloadError((err as Error).message);
  }
  await handle.close();

  const sha256 = hash.digest('hex');
  if (opts.expectedSha256 && opts.expectedSha256 !== sha256) {
    await fs.rm(tmp, { force: true });
    throw new DownloadError(
      'Checksum mismatch: the downloaded file is not the file we expected.',
      `Expected ${opts.expectedSha256}, got ${sha256}. Nothing was installed.`,
    );
  }

  await fs.rename(tmp, destination);
  return { bytes: received, sha256, verified: Boolean(opts.expectedSha256) };
}

async function* streamOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
