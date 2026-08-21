/**
 * One workspace's folder of markdown files, held in memory as an index.
 *
 * There is exactly one of these per workspace and it knows nothing about any other: its
 * paths are its own folder's, and every read it can perform is a read of a file inside it.
 * That is deliberate. It is what lets the assistant be handed a workspace and be *unable*
 * to see the rest of the vault, rather than merely being asked not to look.
 *
 * There is no database. At personal scale — hundreds of tasks, thousands of log lines —
 * reading every file at boot costs milliseconds and removes an entire class of problem
 * (schema drift, migrations, a cache that disagrees with the files). If that ever stops
 * being true, the fix is a cache under `.planner/`, not a different source of truth.
 *
 * Two invariants:
 *   - Writes are atomic (temp file + rename) so a crash mid-write cannot truncate a task.
 *   - Writes are guarded by a content hash taken at load. If the file changed underneath
 *     us — someone editing in Obsidian, most likely — we refuse and report a conflict
 *     rather than overwrite work we never saw.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { parseTaskFile, type ParsedTaskFile } from './markdown.js';
import { deriveSignals } from './derive.js';
import { slugify } from './ids.js';
import {
  DEFAULT_LANES,
  mergeLanes,
  parseBoardFile,
  serializeBoardFile,
  type ParsedBoard,
} from './board.js';
import { humanizeWorkspaceId, workspaceOfPath, type WorkspacePaths } from './workspaces.js';
import type { Board, Lane, Task } from '@shared/types.js';

export class ConflictError extends Error {
  constructor(readonly path: string) {
    super(`"${path}" changed on disk since it was read. Reload and try again.`);
    this.name = 'ConflictError';
  }
}
export class NotFoundError extends Error {
  constructor(readonly ref: string) {
    super(`No task matching "${ref}".`);
    this.name = 'NotFoundError';
  }
}

interface Entry {
  /** Vault-relative, always with forward slashes. */
  path: string;
  parsed: ParsedTaskFile;
  hash: string;
  archived: boolean;
}

export interface SearchMatch {
  task: Task;
  score: number;
}

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

export class VaultStore {
  private entries = new Map<string, Entry>();
  /** id -> vault-relative path, so a rename does not lose the identity. */
  private byId = new Map<string, string>();
  /** The board file exactly as it reads, before tasks get a say about the lanes. */
  private board: ParsedBoard = { lanes: [...DEFAULT_LANES], body: '', problems: [] };

  /**
   * @param paths this workspace's folder, plus the vault root that task paths are
   *   relative to — so `task.path` stays a vault-relative `work/tasks/thing.md`.
   * @param id the workspace's folder name; the empty string is the vault root.
   */
  constructor(
    private readonly paths: WorkspacePaths,
    readonly id: string = '',
  ) {}

  /** What this workspace is called: what `board.md` says, or its folder name. */
  get name(): string {
    return this.board.name ?? humanizeWorkspaceId(this.id);
  }

  /* ------------------------------------------------------------ reading */

  async load(): Promise<void> {
    const next = new Map<string, Entry>();
    for (const root of [this.paths.tasks, this.paths.archive] as const) {
      const archived = root === this.paths.archive;
      for (const abs of await walkMarkdown(root)) {
        const entry = await this.readEntry(abs, archived);
        if (entry) next.set(entry.path, entry);
      }
    }
    this.entries = next;
    this.reindex();
    await this.loadBoard();
  }

  /* -------------------------------------------------------------- lanes */

  /** Re-read `board.md`. Missing or broken means the defaults, never an exception. */
  async loadBoard(): Promise<Board> {
    let raw: string | undefined;
    try {
      raw = await fs.readFile(this.paths.board, 'utf8');
    } catch {
      raw = undefined;
    }
    this.board = parseBoardFile(raw);
    return this.boardView();
  }

  /**
   * The lanes the UI should draw: what the file says, plus any lane a task refers to that
   * the file forgot. That merge is what makes a hand-typed `status:` safe.
   */
  lanes(): Lane[] {
    const inUse = new Set<string>();
    for (const entry of this.entries.values()) {
      if (!entry.archived) inUse.add(entry.parsed.fields.status);
    }
    return mergeLanes(this.board.lanes, inUse);
  }

  boardView(): Board {
    return { workspace: this.id, lanes: this.lanes(), problems: [...this.board.problems] };
  }

  hasLane(id: string): boolean {
    return this.lanes().some((lane) => lane.id === id);
  }

  /** The completion lane's id, when the board names one. */
  doneLaneId(): string | undefined {
    return this.lanes().find((lane) => lane.done)?.id;
  }

  isDoneLane(status: string): boolean {
    return this.doneLaneId() === status;
  }

  /** Replace the lane list. Keeps the workspace's name and whatever prose the file holds. */
  async saveLanes(lanes: Lane[]): Promise<Board> {
    await this.writeBoard(lanes, this.board.name);
    return this.loadBoard();
  }

  /** Rename the workspace. One line of one file: no folder moves, no task is touched. */
  async saveName(name: string): Promise<Board> {
    await this.writeBoard(this.lanes(), name);
    return this.loadBoard();
  }

  private async writeBoard(lanes: Lane[], name: string | undefined): Promise<void> {
    await fs.mkdir(this.paths.dir, { recursive: true });
    await writeAtomic(this.paths.board, serializeBoardFile(lanes, name, this.board.body));
  }

  private reindex(): void {
    const byId = new Map<string, string>();
    for (const entry of this.entries.values()) {
      // First writer wins, so a duplicated id is visible as a problem rather than silently
      // shadowing another task.
      const existing = byId.get(entry.parsed.fields.id);
      if (existing && existing !== entry.path) {
        entry.parsed.problems.push(`Duplicate id, also used by "${existing}".`);
        continue;
      }
      byId.set(entry.parsed.fields.id, entry.path);
    }
    this.byId = byId;
  }

  private async readEntry(abs: string, archived: boolean): Promise<Entry | null> {
    try {
      const [raw, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
      const rel = this.relative(abs);
      return {
        path: rel,
        parsed: parseTaskFile(raw, rel, { fallbackTime: stat.mtime.toISOString() }),
        hash: hashOf(raw),
        archived,
      };
    } catch {
      return null;
    }
  }

  private relative(abs: string): string {
    return path.relative(this.paths.vault, abs).split(path.sep).join('/');
  }

  private absolute(rel: string): string {
    return path.join(this.paths.vault, ...rel.split('/'));
  }

  private toTask(entry: Entry, now: Date): Task {
    const { fields, description, log } = entry.parsed;
    return {
      fields,
      description,
      log,
      derived: deriveSignals(fields, log, now, this.isDoneLane(fields.status)),
      path: entry.path,
      archived: entry.archived,
    };
  }

  list(now = new Date()): Task[] {
    return [...this.entries.values()].map((e) => this.toTask(e, now));
  }

  get(id: string, now = new Date()): Task | undefined {
    const rel = this.byId.get(id);
    const entry = rel ? this.entries.get(rel) : undefined;
    return entry ? this.toTask(entry, now) : undefined;
  }

  getByPath(rel: string, now = new Date()): Task | undefined {
    const entry = this.entries.get(rel);
    return entry ? this.toTask(entry, now) : undefined;
  }

  problemsFor(id: string): string[] {
    const rel = this.byId.get(id);
    const entry = rel ? this.entries.get(rel) : undefined;
    return entry ? [...entry.parsed.problems] : [];
  }

  /** Raw file text, for building a diff without touching the disk. */
  /**
   * Where this workspace keeps its attachments.
   *
   * The only path handed out, and it is this workspace's — the isolation stays
   * structural, so an attachment handler cannot reach another workspace's files even by
   * being given the wrong name.
   */
  get attachmentsDir(): string {
    return this.paths.attachments;
  }

  rawOf(id: string): string | undefined {
    const rel = this.byId.get(id);
    return rel ? this.entries.get(rel)?.parsed.raw : undefined;
  }

  /** Raw file text by vault-relative path, for judging whether a draft has gone stale. */
  rawOfPath(rel: string): string | undefined {
    return this.entries.get(rel)?.parsed.raw;
  }

  pathOf(id: string): string | undefined {
    return this.byId.get(id);
  }

  /* ------------------------------------------------------------ searching */

  search(query: string, now = new Date()): SearchMatch[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matches: SearchMatch[] = [];
    for (const entry of this.entries.values()) {
      const { fields, description, log } = entry.parsed;
      let score = 0;
      if (fields.title.toLowerCase().includes(q)) score += 10;
      if (fields.tags?.some((t) => t.toLowerCase().includes(q))) score += 6;
      if (log.some((e) => e.text.toLowerCase().includes(q))) score += 4;
      if (description.toLowerCase().includes(q)) score += 3;
      if (score > 0) matches.push({ task: this.toTask(entry, now), score });
    }
    return matches.sort(
      (a, b) => b.score - a.score || a.task.fields.title.localeCompare(b.task.fields.title),
    );
  }

  /**
   * Turn whatever the user (or the model) said into one task, or nothing.
   *
   * Deliberately refuses to guess when a fragment matches more than one task. A chatbot
   * that picks the wrong task confidently is far worse than one that asks which you meant.
   */
  resolve(ref: string, now = new Date()): Task | undefined {
    const needle = ref.trim();
    if (!needle) return undefined;

    const exactId = this.get(needle, now);
    if (exactId) return exactId;

    const lower = needle.toLowerCase();
    const all = this.list(now);
    const byId = all.filter((t) => t.fields.id.toLowerCase() === lower);
    if (byId.length === 1) return byId[0];

    const exactTitle = all.filter((t) => t.fields.title.toLowerCase() === lower);
    if (exactTitle.length === 1) return exactTitle[0];

    const partial = all.filter((t) => t.fields.title.toLowerCase().includes(lower));
    return partial.length === 1 ? partial[0] : undefined;
  }

  /* ------------------------------------------------------------- writing */

  /**
   * Apply a pure transformation to one task's file text. The mutate function must be a
   * function of the raw text alone — that is what makes every write previewable as a diff
   * before it happens.
   */
  async writeTask(id: string, mutate: (raw: string) => string): Promise<Task> {
    const rel = this.byId.get(id);
    const entry = rel ? this.entries.get(rel) : undefined;
    if (!entry || !rel) throw new NotFoundError(id);

    const abs = this.absolute(rel);
    const onDisk = await fs.readFile(abs, 'utf8');
    if (hashOf(onDisk) !== entry.hash) {
      // Refresh the index so the UI can show what the file actually says now.
      const fresh = await this.readEntry(abs, entry.archived);
      if (fresh) this.entries.set(rel, fresh);
      throw new ConflictError(rel);
    }

    const next = mutate(onDisk);
    if (next !== onDisk) await writeAtomic(abs, next);

    const updated = await this.readEntry(abs, entry.archived);
    if (updated) this.entries.set(rel, updated);
    this.reindex();
    return this.get(id) ?? this.getByPath(rel)!;
  }

  /** Create a brand-new file. The filename is derived from the title and never collides. */
  async createTask(title: string, content: string): Promise<Task> {
    const dir = this.paths.tasks;
    await fs.mkdir(dir, { recursive: true });
    const base = slugify(title);
    let name = `${base}.md`;
    for (let n = 2; await exists(path.join(dir, name)); n++) name = `${base}-${n}.md`;

    const abs = path.join(dir, name);
    await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
    const entry = await this.readEntry(abs, false);
    if (!entry) throw new Error(`Could not read back "${name}" after creating it.`);
    this.entries.set(entry.path, entry);
    this.reindex();
    return this.toTask(entry, new Date());
  }

  /** Move a task between `tasks/` and `archive/`. */
  async moveTask(id: string, toArchive: boolean): Promise<Task> {
    const rel = this.byId.get(id);
    const entry = rel ? this.entries.get(rel) : undefined;
    if (!entry || !rel) throw new NotFoundError(id);
    if (entry.archived === toArchive) return this.toTask(entry, new Date());

    const dir = toArchive ? this.paths.archive : this.paths.tasks;
    await fs.mkdir(dir, { recursive: true });
    const base = path.basename(rel, '.md');
    let name = `${base}.md`;
    for (let n = 2; await exists(path.join(dir, name)); n++) name = `${base}-${n}.md`;

    const to = path.join(dir, name);
    await fs.rename(this.absolute(rel), to);
    this.entries.delete(rel);
    const moved = await this.readEntry(to, toArchive);
    if (moved) this.entries.set(moved.path, moved);
    this.reindex();
    return this.get(id) ?? this.toTask(moved!, new Date());
  }

  async deleteTask(id: string): Promise<void> {
    const rel = this.byId.get(id);
    if (!rel) throw new NotFoundError(id);
    await fs.rm(this.absolute(rel), { force: true });
    this.entries.delete(rel);
    this.reindex();
  }

  /* ------------------------------------------------------------- watching */

  /** Re-read one file after the watcher saw it change. Returns the new projection. */
  async syncPath(rel: string): Promise<Task | undefined> {
    const archived = workspaceOfPath(rel)?.archived ?? false;
    const entry = await this.readEntry(this.absolute(rel), archived);
    if (!entry) {
      this.forgetPath(rel);
      return undefined;
    }
    this.entries.set(rel, entry);
    this.reindex();
    return this.toTask(entry, new Date());
  }

  forgetPath(rel: string): void {
    this.entries.delete(rel);
    this.reindex();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Open tasks, for the workspace switcher.
   *
   * Open means neither archived nor finished. Archiving and finishing are different acts —
   * a task sits in the done lane long before anyone files it away, and often forever — so
   * counting merely-unarchived tasks reported every completed task as still open and made
   * the number grow monotonically no matter how much work got done.
   *
   * Which lane means finished is the board's to say, never this file's.
   */
  get openCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.archived) continue;
      if (this.isDoneLane(entry.parsed.fields.status)) continue;
      count++;
    }
    return count;
  }

  /** True when nothing would be lost by deleting this workspace's folder. */
  get isEmpty(): boolean {
    return this.entries.size === 0;
  }
}

/* ----------------------------------------------------------------- helpers */

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/**
 * Write via a temp file in the same directory then rename. `rename` within a filesystem is
 * atomic, so a reader either sees the whole old file or the whole new one — never a
 * half-written task.
 */
async function writeAtomic(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Every `.md` under `root`, skipping dotfiles and dot-directories. */
async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) await visit(abs);
      else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) out.push(abs);
    }
  };
  await visit(root);
  return out.sort();
}
