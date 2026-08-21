/**
 * Resolve GGUF models from Hugging Face at runtime.
 *
 * The previous version of this app shipped a hardcoded catalog: two models, with
 * filenames and sizes typed in by hand. That was wrong in a way that was obvious within
 * months -- new model families ship constantly, quant filenames vary per publisher, and a
 * baked-in list is stale the day it is written. Worse, the sizes and checksums in it were
 * guesses, which is how you end up shipping a number nobody verified.
 *
 * So nothing here is remembered. Repo contents, filenames and byte sizes all come from
 * the API at the moment the user looks, which means the size shown before a download is
 * the real one and the list never goes out of date.
 *
 * This is the *only* module that talks to a non-loopback host, and it is only ever
 * reached from an explicit user action in the model picker. No task data is ever sent.
 */

const HF_API = 'https://huggingface.co/api';
const HF_HOST = 'https://huggingface.co';

/** `owner/name`, and nothing that could climb out of a URL path. */
const REPO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GGUF_FILE = /^[A-Za-z0-9][A-Za-z0-9._@-]*\.gguf$/i;

export class HuggingFaceError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'HuggingFaceError';
  }
}

export function isValidRepoId(repo: string): boolean {
  return REPO_ID.test(repo);
}
export function isValidGgufFile(file: string): boolean {
  return GGUF_FILE.test(file);
}

async function hf<T>(path: string, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${HF_API}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new HuggingFaceError(
      'Could not reach Hugging Face.',
      `${(err as Error).message}. Browsing models is the one part of the planner that needs the internet.`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new HuggingFaceError(
      'That repository is private, gated, or does not exist.',
      'Hugging Face answers 401 for all three. Gated repos need a licence click, so they cannot be part of a one-click install.',
    );
  }
  if (!res.ok) {
    throw new HuggingFaceError(`Hugging Face returned HTTP ${res.status}.`);
  }
  return (await res.json()) as T;
}

/* ---------------------------------------------------------------- searching */

export interface RepoSummary {
  repo: string;
  downloads: number;
  likes: number;
  updatedAt?: string;
}

/**
 * Find GGUF repositories. The `gguf` library filter is what keeps this useful -- a plain
 * text search returns thousands of unquantized repos we could not run.
 */
export async function searchGgufRepos(query: string, limit = 20): Promise<RepoSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    search: q,
    filter: 'gguf',
    limit: String(Math.min(limit, 50)),
    sort: 'downloads',
    direction: '-1',
  });
  const raw = await hf<
    { id: string; downloads?: number; likes?: number; lastModified?: string }[]
  >(`/models?${params}`);

  return raw
    .filter((m) => isValidRepoId(m.id))
    .map((m) => ({
      repo: m.id,
      downloads: m.downloads ?? 0,
      likes: m.likes ?? 0,
      ...(m.lastModified ? { updatedAt: m.lastModified } : {}),
    }));
}

/* ------------------------------------------------------------------- files */

export interface GgufFile {
  file: string;
  sizeBytes: number;
  /** Q4_K_M, IQ4_XS, BF16 ... parsed from the filename. */
  quant: string;
  /** True for the quant we would pick for someone who does not want to choose. */
  recommended: boolean;
  /** Part 1 of a split model; the rest download alongside it. */
  split: boolean;
}

/**
 * Quantization preference, best first.
 *
 * Q4_K_M is the long-standing sweet spot for a local assistant: roughly 4.5 bits per
 * weight, small enough to load quickly, and the level at which instruction following and
 * tool calling still hold up. Below Q4 both degrade noticeably, which matters more here
 * than raw perplexity because the model has to emit well-formed tool calls.
 */
const QUANT_PREFERENCE = ['Q4_K_M', 'Q4_K_XL', 'Q4_K_S', 'Q4_0', 'IQ4_XS', 'IQ4_NL', 'Q5_K_M'];

export function parseQuant(file: string): string {
  const m = file.match(/(?:^|[.\-_])((?:UD-)?(?:I?Q\d[A-Z0-9_]*|BF16|F16|F32))(?:[.\-_]|\.gguf$)/i);
  return m?.[1]?.toUpperCase().replace(/^UD-/, '') ?? 'unknown';
}

/** List the runnable GGUF files in a repo, with their real sizes. */
export async function listGgufFiles(repo: string): Promise<GgufFile[]> {
  if (!isValidRepoId(repo)) {
    throw new HuggingFaceError(`"${repo}" is not a repository id.`, 'Use the owner/name form.');
  }
  const tree = await hf<{ type: string; path: string; size?: number }[]>(
    `/models/${repo}/tree/main?recursive=true`,
  );

  const files = tree
    .filter((f) => f.type === 'file' && f.path.toLowerCase().endsWith('.gguf'))
    // `mmproj-*.gguf` is the multimodal projector that accompanies a vision model, not a
    // model you can load. It matters that these are excluded rather than merely labelled:
    // they are the smallest files in the repo, so they sort to the top of a size-ordered
    // list and look exactly like a bargain.
    .filter((f) => !/(?:^|\/)mmproj[.\-_]/i.test(f.path))
    // Split models are published as `-00001-of-000NN`; only the first part is selectable,
    // and llama.cpp picks up the rest by name.
    .filter((f) => !/-\d{5}-of-\d{5}\.gguf$/i.test(f.path) || /-00001-of-\d{5}\.gguf$/i.test(f.path))
    .map((f) => ({
      file: f.path,
      sizeBytes: f.size ?? 0,
      quant: parseQuant(f.path),
      recommended: false,
      split: /-00001-of-\d{5}\.gguf$/i.test(f.path),
    }))
    .filter((f) => isValidGgufFile(f.file.split('/').pop() ?? ''));

  // Mark exactly one recommendation: the highest-preference quant present.
  const best = QUANT_PREFERENCE.map((q) => files.find((f) => f.quant === q)).find(Boolean);
  if (best) best.recommended = true;

  return files.sort((a, b) => a.sizeBytes - b.sizeBytes);
}

/** A path segment inside a repo: no traversal, no empties, no oddities. */
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

export function downloadUrl(repo: string, file: string): string {
  if (!isValidRepoId(repo)) throw new HuggingFaceError(`"${repo}" is not a repository id.`);

  // Validate EVERY segment, not just the basename. Checking only the last part looks
  // sufficient and is not: `../../secret.gguf` has a perfectly good basename and would
  // otherwise be pasted straight into the URL path.
  const segments = file.split('/');
  const name = segments.at(-1) ?? '';
  if (!isValidGgufFile(name)) throw new HuggingFaceError(`"${file}" is not a .gguf file.`);
  if (!segments.every((s) => PATH_SEGMENT.test(s))) {
    throw new HuggingFaceError(`"${file}" is not a path inside that repository.`);
  }

  const path = segments.map((s) => encodeURIComponent(s)).join('/');
  return `${HF_HOST}/${repo}/resolve/main/${path}?download=true`;
}

/* --------------------------------------------------------------- judgement */

/**
 * How dependable a model of this size is at *tool calling*, which is the demanding half
 * of what the planner asks for. Summarizing is easy at any size; emitting a correct tool
 * call with correct arguments is not.
 *
 * Judged from parameter count parsed out of the name, because that is the only thing we
 * can know about a family that did not exist when this was written. It is a rule of
 * thumb about a size class, not a claim about any specific model, and the UI says so.
 */
export function toolCallingForSize(repo: string): {
  level: 'unreliable' | 'workable' | 'reliable' | 'unknown';
  params?: number;
} {
  // Prefer an active-parameter count for MoE names like `35B-A3B`, since that is what
  // actually does the work per token. `E4B` is Gemma's effective-parameter notation and
  // means the same thing: the model is served like a 4B despite a larger total.
  const moe = repo.match(/(\d+(?:\.\d+)?)B-A(\d+(?:\.\d+)?)B/i);
  const effective = repo.match(/(?:^|[^A-Za-z0-9])E(\d+(?:\.\d+)?)B(?![A-Za-z0-9])/i);
  const plain = repo.match(/(?:^|[^A-Za-z0-9])(\d+(?:\.\d+)?)\s*B(?![A-Za-z0-9])/i);
  const raw = moe?.[2] ?? effective?.[1] ?? plain?.[1];
  if (!raw) return { level: 'unknown' };

  const params = Number(raw);
  if (!Number.isFinite(params)) return { level: 'unknown' };
  if (params < 3) return { level: 'unreliable', params };
  if (params < 7) return { level: 'workable', params };
  return { level: 'reliable', params };
}
