import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * What the plugin can run, and where to start looking.
 *
 * There is deliberately **no hardcoded model catalog** here any more. Model families ship
 * constantly and quant filenames vary per publisher, so a list written into the source is
 * stale within months -- and the sizes and checksums in such a list are inevitably numbers
 * nobody verified. Everything about a model now comes from the Hugging Face API at the
 * moment the user browses (see `huggingface.ts`), or from what is actually on disk.
 *
 * What remains here is the llama.cpp runtime, which genuinely must be pinned: it ships
 * several builds a day and regularly changes server flags, so "latest" is a time bomb and
 * a build tag is a decision.
 */

/**
 * Pinned llama.cpp release.
 *
 * Pinning is not optional here: llama.cpp ships several builds a day and regularly changes
 * server flags and archive layout, so "latest" is a time bomb.
 *
 * But a pin that is too OLD is worse than no pin. This was `b4585` (early 2025) until it
 * was checked: those URLs resolved perfectly, and the runtime they fetched could not load
 * a single one of the model families this app suggests, because new architectures need a
 * recent llama.cpp. A stale pin fails at model-load time with a baffling error, long after
 * the download appeared to succeed.
 *
 * So: when bumping this, re-check three things together -- the tag, the per-platform asset
 * names (they have changed: macOS and Linux moved from .zip to .tar.gz, and the Windows
 * CPU build was renamed from `win-avx2-x64` to `win-cpu-x64`), and the sha256 of each
 * asset, by downloading it once and recording the real digest.
 */
export const LLAMA_BUILD = 'b10516';
const LLAMA_RELEASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}`;

export interface RuntimeAsset {
  platform: string;
  url: string;
  /** Real digests, recorded by downloading each asset once. Never invented. */
  sha256: string;
  archive: 'zip' | 'tar.gz';
  /** Name of the server binary inside the archive, once flattened. */
  binaryName: string;
}

export const RUNTIME_ASSETS: RuntimeAsset[] = [
  {
    platform: 'darwin-arm64',
    url: `${LLAMA_RELEASE}/llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`,
    sha256: 'ee3324327d621026ae80c24031670e65fa62a0b23a3a027dbe2f65f240affd30',
    archive: 'tar.gz',
    binaryName: 'llama-server',
  },
  {
    platform: 'darwin-x64',
    url: `${LLAMA_RELEASE}/llama-${LLAMA_BUILD}-bin-macos-x64.tar.gz`,
    sha256: 'b7adecf7bd2cde577ddabee8357a72409165d8104f43b4acee9f1b98cc9c447a',
    archive: 'tar.gz',
    binaryName: 'llama-server',
  },
  {
    platform: 'win32-x64',
    url: `${LLAMA_RELEASE}/llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`,
    sha256: 'fbbbc55e0eb2e1b07f9dcb9488616c98ed47d9003b90e15e7c8c7812c4307cd3',
    archive: 'zip',
    binaryName: 'llama-server.exe',
  },
  {
    platform: 'linux-x64',
    url: `${LLAMA_RELEASE}/llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`,
    sha256: 'f263a91280471b4c33c4999d7c76259c0f3a0a53a0b3e692b2c0b84380137a35',
    archive: 'tar.gz',
    binaryName: 'llama-server',
  },
];

export function platformKey(): string {
  return `${process.platform}-${os.arch()}`;
}

export function runtimeAssetForThisPlatform(): RuntimeAsset | undefined {
  return RUNTIME_ASSETS.find((a) => a.platform === platformKey());
}

/**
 * Starting points for the model picker -- repository ids only.
 *
 * No filenames, no sizes, no checksums: those are read from the API when the user opens a
 * repo, so they are always current and always real. These are simply a shortlist so the
 * picker is not an empty search box, and the user can type any `owner/name` instead.
 *
 * Chosen for: ungated (a licence click cannot be part of a one-click install), published
 * as GGUF, and small enough to run on an ordinary laptop.
 */
export interface SuggestedRepo {
  repo: string;
  label: string;
  note: string;
}

export const SUGGESTED_REPOS: SuggestedRepo[] = [
  {
    repo: 'unsloth/Qwen3.5-4B-GGUF',
    label: 'Qwen3.5 4B',
    note: 'A good default. Small enough to be quick, big enough to drive the tools.',
  },
  {
    repo: 'unsloth/Qwen3.5-9B-GGUF',
    label: 'Qwen3.5 9B',
    note: 'Better at multi-step requests. Wants roughly 7 GB free.',
  },
  {
    repo: 'unsloth/gemma-4-E4B-it-GGUF',
    label: 'Gemma 4 E4B',
    note: "Google's small instruction model.",
  },
  {
    repo: 'unsloth/gemma-4-12B-it-GGUF',
    label: 'Gemma 4 12B',
    note: 'Noticeably stronger, noticeably heavier.',
  },
  {
    repo: 'unsloth/Qwen3.5-2B-GGUF',
    label: 'Qwen3.5 2B',
    note: 'Fastest and lightest. Fine for summaries; expect tool calls to miss sometimes.',
  },
  {
    repo: 'bartowski/Qwen_Qwen2.5-7B-Instruct-GGUF',
    label: 'Qwen2.5 7B',
    note: 'Older, but a well-understood and dependable tool caller.',
  },
];

/* --------------------------------------------------------- what is on disk */

export interface DownloadedModel {
  /** Filename, which is also the id used to select it. */
  file: string;
  sizeBytes: number;
  installedAt: string;
}

/** Whatever GGUF files are sitting in the models directory. The disk is the source of truth. */
export async function listDownloadedModels(modelsDir: string): Promise<DownloadedModel[]> {
  let entries;
  try {
    entries = await fs.readdir(modelsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DownloadedModel[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) continue;
    try {
      const stat = await fs.stat(path.join(modelsDir, entry.name));
      out.push({
        file: entry.name,
        sizeBytes: stat.size,
        installedAt: stat.mtime.toISOString(),
      });
    } catch {
      // A file that vanished mid-scan is simply not installed.
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Guard against a selected filename escaping the models directory. */
export function isSafeModelFile(file: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._@-]*\.gguf$/i.test(file) && !file.includes('..');
}
