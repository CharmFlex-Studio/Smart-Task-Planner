/**
 * The markdown <-> Task boundary. The single most safety-critical file in the vault:
 * everything here exists to make sure a file someone hand-edited survives a round trip.
 *
 * Two rules govern this module:
 *
 *   1. Parsing is TOLERANT. A file with broken YAML, no frontmatter, junk in the log or
 *      an unfamiliar heading still yields a usable Task rather than an exception. The
 *      vault is a folder humans type into; it will contain surprises.
 *
 *   2. Writing is SURGICAL. We never re-serialize a whole file. Setting a field rewrites
 *      exactly the lines that hold that field; appending a log entry only touches the
 *      tail. Bytes we did not mean to change are therefore *provably* unchanged, which is
 *      the only way to promise that unknown frontmatter keys, comments and someone's
 *      preferred formatting all survive.
 */

import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { LOG_TYPES, type LogEntry, type LogType, type TaskFields } from '@shared/types.js';
import { FALLBACK_LANE_ID } from './board.js';

export interface ParsedTaskFile {
  fields: TaskFields;
  description: string;
  log: LogEntry[];
  /** The original text, byte for byte. */
  raw: string;
  hasFrontmatter: boolean;
  /** Non-fatal complaints — surfaced in the UI so a broken file is visible, not silent. */
  problems: string[];
}

const FENCE = '---';
/** `- 2026-08-20 09:30 · progress · text` — the canonical log line. */
const LOG_LINE =
  /^[ \t]*[-*][ \t]+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})[ \t]*·[ \t]*(?:([A-Za-z]+)[ \t]*·[ \t]*)?(.*)$/;
const LOG_HEADING = /^#{1,6}[ \t]+log[ \t]*$/i;
const MD_HEADING = /^#{1,6}[ \t]+(.*\S)[ \t]*$/;

function detectEol(raw: string): '\n' | '\r\n' {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * A deterministic id for a file that has no `id:` in its frontmatter, derived from its
 * path. Stable across restarts, so a hand-written note keeps the same identity in the UI
 * until the app materializes real frontmatter for it.
 */
export function syntheticId(path: string): string {
  return 'p' + createHash('sha256').update(path).digest('hex').slice(0, 24);
}

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
}

/** A status is whatever lane the file names — the board decides what that means. */
function asLaneRef(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s ? s : undefined;
}

function asLogType(value: unknown): LogType | undefined {
  const s = String(value ?? '').toLowerCase();
  return (LOG_TYPES as readonly string[]).includes(s) ? (s as LogType) : undefined;
}

function asStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

interface Split {
  /** Index of the first body line, i.e. one past the closing fence. */
  bodyStart: number;
  /** Index of the opening fence, or -1. */
  fmStart: number;
  /** Index of the closing fence, or -1. */
  fmEnd: number;
}

function splitFrontmatter(lines: string[]): Split {
  if (lines[0]?.trim() !== FENCE) return { bodyStart: 0, fmStart: -1, fmEnd: -1 };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]?.trim();
    if (t === FENCE || t === '...') return { bodyStart: i + 1, fmStart: 0, fmEnd: i };
  }
  // An opening fence with no closing fence is not frontmatter — treat the whole thing as body.
  return { bodyStart: 0, fmStart: -1, fmEnd: -1 };
}

export function parseTaskFile(
  raw: string,
  path: string,
  opts: { fallbackTime?: string } = {},
): ParsedTaskFile {
  const eol = detectEol(raw);
  const lines = raw.split(eol);
  const problems: string[] = [];
  const { bodyStart, fmStart, fmEnd } = splitFrontmatter(lines);
  const hasFrontmatter = fmStart >= 0;

  let fm: Record<string, unknown> = {};
  if (hasFrontmatter) {
    const text = lines.slice(fmStart + 1, fmEnd).join('\n');
    try {
      const parsed = parseYaml(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fm = parsed as Record<string, unknown>;
      } else if (parsed !== null && parsed !== undefined) {
        problems.push('Frontmatter is not a key/value block; ignoring it.');
      }
    } catch (err) {
      problems.push(`Frontmatter is not valid YAML: ${(err as Error).message}`);
    }
  }

  // --- body: description, then an optional `## Log` section ---------------
  const body = lines.slice(bodyStart);
  let logAt = body.findIndex((l) => LOG_HEADING.test(l));
  if (logAt < 0) logAt = body.length;

  const description = body.slice(0, logAt).join('\n').trim();
  const log = parseLog(body.slice(logAt + 1));

  const headingTitle = body.slice(0, logAt).map((l) => l.match(MD_HEADING)?.[1]).find(Boolean);

  const fallback = opts.fallbackTime ?? '';
  const fields: TaskFields = {
    id: asStringOrUndefined(fm.id) ?? syntheticId(path),
    title: asStringOrUndefined(fm.title) ?? headingTitle ?? titleFromPath(path),
    status: asLaneRef(fm.status) ?? FALLBACK_LANE_ID,
    created: asStringOrUndefined(fm.created) ?? fallback,
    updated: asStringOrUndefined(fm.updated) ?? asStringOrUndefined(fm.created) ?? fallback,
  };
  const due = asStringOrUndefined(fm.due);
  if (due) fields.due = due;
  const tags = asTags(fm.tags);
  if (tags?.length) fields.tags = tags;

  return { fields, description, log, raw, hasFrontmatter, problems };
}

function parseLog(lines: string[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of lines) {
    const m = line.match(LOG_LINE);
    if (m) {
      const [, date, time, rawType, text] = m;
      out.push({
        at: `${date}T${time}`,
        type: asLogType(rawType) ?? 'note',
        // A missing type means the whole remainder is the text.
        text: (rawType && !asLogType(rawType) ? `${rawType} · ${text}` : (text ?? '')).trim(),
      });
      continue;
    }
    // Indented, non-bullet lines continue the entry above.
    const last = out.at(-1);
    if (last && /^[ \t]+\S/.test(line)) {
      last.text = `${last.text}\n${line.trim()}`;
    }
    // Anything else is junk we deliberately ignore. Because writes are surgical it stays
    // in the file untouched; we simply do not show it as an entry.
  }
  return out;
}

/* --------------------------------------------------------------- writing */

/** Render a value the way YAML wants it, quoting only when it has to. */
function formatValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatValue(v)).join(', ')}]`;
  }
  // stringify a bare scalar, disabling line folding so long values stay on one line.
  return stringifyYaml(value, { lineWidth: 0 }).trimEnd();
}

/** The lines occupied by `key` in a frontmatter block: the key line plus its indented continuation. */
function keyRange(lines: string[], from: number, to: number, key: string): [number, number] | null {
  const head = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*:`);
  for (let i = from; i < to; i++) {
    if (head.test(lines[i] ?? '')) {
      let end = i + 1;
      while (end < to && /^[ \t]+\S/.test(lines[end] ?? '')) end++;
      return [i, end];
    }
  }
  return null;
}

/**
 * Set (or, with `value === undefined`, remove) one frontmatter key, touching nothing else.
 * Creates a frontmatter block if the file has none.
 */
export function setFrontmatterField(
  raw: string,
  key: string,
  value: string | string[] | undefined,
): string {
  const eol = detectEol(raw);
  const lines = raw.split(eol);
  const { fmStart, fmEnd } = splitFrontmatter(lines);

  if (fmStart < 0) {
    if (value === undefined) return raw;
    return [FENCE, `${key}: ${formatValue(value)}`, FENCE, '', raw].join(eol);
  }

  const range = keyRange(lines, fmStart + 1, fmEnd, key);
  const next = [...lines];

  if (value === undefined) {
    if (!range) return raw;
    next.splice(range[0], range[1] - range[0]);
  } else {
    const rendered = `${key}: ${formatValue(value)}`;
    if (range) next.splice(range[0], range[1] - range[0], rendered);
    else next.splice(fmEnd, 0, rendered);
  }
  return next.join(eol);
}

/**
 * Replace the description — the prose between the frontmatter and the `## Log` heading —
 * leaving the frontmatter and the whole log untouched. Same promise as the frontmatter
 * setter: bytes outside the region are provably unchanged.
 */
export function setDescription(raw: string, text: string): string {
  const eol = detectEol(raw);
  const lines = raw.split(eol);
  const { bodyStart } = splitFrontmatter(lines);
  const body = lines.slice(bodyStart);

  let logAt = body.findIndex((l) => LOG_HEADING.test(l));
  if (logAt < 0) logAt = body.length;

  const head = lines.slice(0, bodyStart);
  const tail = body.slice(logAt);
  const description = text.replace(/\r\n/g, '\n').trim();

  const out = [...head];
  if (head.length > 0) out.push('');
  if (description) out.push(...description.split('\n'), '');
  out.push(...tail);
  // A file that is now nothing but frontmatter still ends with a newline.
  if (out.length === head.length + 1 && head.length > 0) return head.join(eol) + eol;
  return out.join(eol);
}

/** `- 2026-08-20 09:30 · progress · text`, with continuation lines indented two spaces. */
export function formatLogLine(entry: LogEntry, eol = '\n'): string {
  const stamp = entry.at.replace('T', ' ').slice(0, 16);
  const [first = '', ...rest] = entry.text.split(/\r?\n/);
  const head = `- ${stamp} · ${entry.type} · ${first}`;
  return [head, ...rest.map((l) => `  ${l}`)].join(eol);
}

/** Append one entry to the tail of the file, creating the `## Log` section if needed. */
export function appendLogEntry(raw: string, entry: LogEntry): string {
  const eol = detectEol(raw);
  const hasHeading = raw.split(eol).some((l) => LOG_HEADING.test(l));
  const line = formatLogLine(entry, eol);
  const base = raw.length === 0 || raw.endsWith(eol) ? raw : raw + eol;

  if (hasHeading) return `${base}${line}${eol}`;
  const gap = base.length === 0 ? '' : eol;
  return `${base}${gap}## Log${eol}${eol}${line}${eol}`;
}

const FIELD_ORDER = ['id', 'title', 'status', 'created', 'updated', 'due', 'tags'] as const;

/** Build a brand-new task file. Only ever used for files that do not exist yet. */
export function serializeNewTask(fields: TaskFields, description = ''): string {
  const eol = '\n';
  const fm: string[] = [];
  for (const key of FIELD_ORDER) {
    const value = fields[key];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    fm.push(`${key}: ${formatValue(value as string | string[])}`);
  }
  const body = description.trim();
  return [
    FENCE,
    ...fm,
    FENCE,
    '',
    ...(body ? [body, ''] : []),
    '## Log',
    '',
    '',
  ].join(eol);
}
