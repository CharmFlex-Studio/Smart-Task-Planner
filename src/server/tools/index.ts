/**
 * The single write path.
 *
 * Every mutation to a *task* — from a button in the UI, from the command palette, from the
 * chatbot — goes through one of these seven operations. Nothing else is allowed to touch a
 * task file. Two things fall out of that:
 *
 *   - The model never writes. It calls the same typed operations the UI does, so "the
 *     chatbot corrupted my vault" is not a failure mode that exists.
 *   - Every write is a *dry run first*. Each operation takes `apply` and, when false,
 *     computes exactly the same bytes and returns the diff without touching the disk.
 *     The chat's confirm-before-apply UI is that flag, and nothing more.
 *
 * The operation list is deliberately short and flat. It doubles as the LLM's tool schema,
 * and small models degrade sharply as the tool count grows. Lanes are edited through a
 * separate set of operations (`tools/lanes.ts`) that the model is deliberately not given.
 */

import {
  LOG_TYPES,
  type LogEntry,
  type LogType,
  type SetFieldName,
  type Task,
  type TaskFields,
  type WriteResult,
} from '@shared/types.js';
import { VaultStore, type SearchMatch } from '../vault/store.js';
import {
  appendLogEntry,
  parseTaskFile,
  serializeNewTask,
  setDescription,
  setFrontmatterField,
} from '../vault/markdown.js';
import { deriveSignals } from '../vault/derive.js';
import { slugify, ulid } from '../vault/ids.js';
import { buildDiff } from './diff.js';
import { ToolError } from './errors.js';
import { localIso, logStamp } from './time.js';

const SET_FIELDS: readonly SetFieldName[] = ['title', 'status', 'due', 'tags', 'description'];
const DUE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export interface ListArgs {
  status?: string;
  tag?: string;
  q?: string;
  includeArchived?: boolean;
}
export interface GetArgs {
  task: string;
}
export interface SearchArgs {
  query: string;
}
export interface CreateArgs {
  title: string;
  status?: string;
  due?: string;
  tags?: string | string[];
  description?: string;
}
export interface AddLogArgs {
  task: string;
  type?: string;
  text: string;
  at?: string;
}
export interface SetFieldArgs {
  task: string;
  field: SetFieldName;
  value: string | string[];
}
export interface ArchiveArgs {
  task: string;
}

export class PlannerTools {
  constructor(
    private readonly store: VaultStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /* --------------------------------------------------------- read tools */

  listTasks(args: ListArgs): Task[] {
    const status = args.status ? this.mustLane(args.status) : undefined;
    const tag = args.tag?.toLowerCase();
    const q = args.q?.trim().toLowerCase();
    return this.store
      .list(this.now())
      .filter((t) => (args.includeArchived ? true : !t.archived))
      .filter((t) => (status ? t.fields.status === status : true))
      .filter((t) => (tag ? t.fields.tags?.some((x) => x.toLowerCase() === tag) : true))
      .filter((t) => (q ? t.fields.title.toLowerCase().includes(q) : true))
      .sort(byRecency);
  }

  getTask(args: GetArgs): Task {
    return this.mustResolve(args.task);
  }

  searchTasks(args: SearchArgs): SearchMatch[] {
    return this.store.search(args.query ?? '', this.now());
  }

  /* -------------------------------------------------------- write tools */

  async createTask(args: CreateArgs, apply: boolean): Promise<WriteResult> {
    const title = (args.title ?? '').trim();
    if (!title) throw new ToolError('invalid', 'A task needs a title.');

    const stamp = localIso(this.now());
    const fields: TaskFields = {
      id: ulid(this.now().getTime()),
      title,
      status: args.status ? this.mustLane(args.status) : this.firstLaneId(),
      created: stamp,
      updated: stamp,
    };
    if (args.due) fields.due = this.mustDue(args.due);
    const tags = normalizeTags(args.tags);
    if (tags?.length) fields.tags = tags;

    const content = serializeNewTask(fields, args.description ?? '');
    const predicted = `tasks/${slugify(title)}.md`;

    if (!apply) {
      return {
        task: this.project(content, predicted, false),
        diff: buildDiff(predicted, '', content),
        applied: false,
      };
    }
    const task = await this.store.createTask(title, content);
    return { task, diff: buildDiff(task.path, '', content), applied: true };
  }

  async addLog(args: AddLogArgs, apply: boolean): Promise<WriteResult> {
    const task = this.mustResolve(args.task);
    const text = (args.text ?? '').trim();
    if (!text) throw new ToolError('invalid', 'A comment needs some text.');

    const entry: LogEntry = {
      at: args.at ? this.mustStamp(args.at) : logStamp(this.now()),
      type: this.mustLogType(args.type),
      text,
    };
    const stamp = localIso(this.now());
    return this.write(
      task,
      (raw) => setFrontmatterField(appendLogEntry(raw, entry), 'updated', stamp),
      apply,
    );
  }

  async setField(args: SetFieldArgs, apply: boolean): Promise<WriteResult> {
    const task = this.mustResolve(args.task);
    if (!SET_FIELDS.includes(args.field)) {
      throw new ToolError(
        'invalid',
        `"${args.field}" is not a task field.`,
        `Try one of: ${SET_FIELDS.join(', ')}.`,
      );
    }
    const stamp = localIso(this.now());

    // The description is the file's body, not a frontmatter key, so it gets its own writer.
    if (args.field === 'description') {
      const text = Array.isArray(args.value) ? args.value.join('\n') : String(args.value ?? '');
      return this.write(
        task,
        (raw) => setFrontmatterField(setDescription(raw, text), 'updated', stamp),
        apply,
      );
    }

    const value = this.coerceField(args.field, args.value);
    return this.write(
      task,
      (raw) => setFrontmatterField(setFrontmatterField(raw, args.field, value), 'updated', stamp),
      apply,
    );
  }

  /** Put a task away: move it to the done lane and move the file into `archive/`. */
  async archiveTask(args: ArchiveArgs, apply: boolean): Promise<WriteResult> {
    const task = this.mustResolve(args.task);
    const stamp = localIso(this.now());
    const done = this.store.doneLaneId() ?? task.fields.status;
    const mutate = (raw: string) =>
      setFrontmatterField(setFrontmatterField(raw, 'status', done), 'updated', stamp);

    const before = this.store.rawOf(task.fields.id) ?? '';
    const after = mutate(before);
    const diff = buildDiff(task.path, before, after);
    if (!apply) {
      const projected = this.project(after, task.path.replace(/^tasks\//, 'archive/'), true);
      return { task: projected, diff, applied: false };
    }
    await this.store.writeTask(task.fields.id, mutate);
    const moved = await this.store.moveTask(task.fields.id, true);
    return { task: moved, diff, applied: true };
  }

  /** Bring an archived task back into play. Not exposed to the model — a UI action only. */
  async restoreTask(args: ArchiveArgs, apply: boolean): Promise<WriteResult> {
    const task = this.mustResolve(args.task);
    const stamp = localIso(this.now());
    const open = this.openLaneId();
    const mutate = (raw: string) =>
      setFrontmatterField(setFrontmatterField(raw, 'status', open), 'updated', stamp);

    const before = this.store.rawOf(task.fields.id) ?? '';
    const diff = buildDiff(task.path, before, mutate(before));
    if (!apply) {
      return { task: this.project(mutate(before), task.path, false), diff, applied: false };
    }
    await this.store.writeTask(task.fields.id, mutate);
    const moved = await this.store.moveTask(task.fields.id, false);
    return { task: moved, diff, applied: true };
  }

  /* ------------------------------------------------------------ internals */

  private async write(
    task: Task,
    mutate: (raw: string) => string,
    apply: boolean,
  ): Promise<WriteResult> {
    const before = this.store.rawOf(task.fields.id) ?? '';
    const after = mutate(before);
    const diff = buildDiff(task.path, before, after);
    if (!apply) {
      return { task: this.project(after, task.path, task.archived), diff, applied: false };
    }
    const updated = await this.store.writeTask(task.fields.id, mutate);
    return { task: updated, diff, applied: true };
  }

  /** What the file *would* look like, parsed back into a Task. Never touches the disk. */
  private project(raw: string, path: string, archived: boolean): Task {
    const parsed = parseTaskFile(raw, path, { fallbackTime: localIso(this.now()) });
    return {
      fields: parsed.fields,
      description: parsed.description,
      log: parsed.log,
      derived: deriveSignals(
        parsed.fields,
        parsed.log,
        this.now(),
        this.store.isDoneLane(parsed.fields.status),
      ),
      path,
      archived,
    };
  }

  private mustResolve(ref: string): Task {
    const task = this.store.resolve(ref ?? '', this.now());
    if (task) return task;
    const candidates = this.store
      .search(ref ?? '', this.now())
      .slice(0, 4)
      .map((m) => m.task.fields.title);
    throw new ToolError(
      'not_found',
      `No single task matches "${ref}".`,
      candidates.length ? `Did you mean: ${candidates.join(' / ')}?` : undefined,
    );
  }

  private firstLaneId(): string {
    return this.store.lanes()[0]!.id;
  }

  /** The lane a restored task belongs in: the first one that is not the done lane. */
  private openLaneId(): string {
    const lanes = this.store.lanes();
    return (lanes.find((lane) => !lane.done) ?? lanes[0]!).id;
  }

  /**
   * Resolve a lane the way a person would refer to it: by id or by the name on the column.
   * Lanes are user-defined, so an unknown one is a mistake worth naming rather than a value
   * to invent a column for.
   */
  private mustLane(value: string): string {
    const v = String(value).trim().toLowerCase();
    const lanes = this.store.lanes();
    const match =
      lanes.find((lane) => lane.id.toLowerCase() === v) ??
      lanes.find((lane) => lane.name.toLowerCase() === v);
    if (match) return match.id;
    throw new ToolError(
      'invalid',
      `"${value}" is not a lane on this board.`,
      `Use one of: ${lanes.map((lane) => lane.name).join(', ')}.`,
    );
  }

  private mustLogType(value: string | undefined): LogType {
    if (!value) return 'note';
    const v = String(value).toLowerCase().trim();
    if ((LOG_TYPES as readonly string[]).includes(v)) return v as LogType;
    throw new ToolError('invalid', `"${value}" is not a log type.`, `Use ${LOG_TYPES.join(', ')}.`);
  }

  private mustDue(value: string): string {
    const v = String(value).trim();
    if (DUE_FORMAT.test(v)) return v;
    throw new ToolError('invalid', `"${value}" is not a date.`, 'Use YYYY-MM-DD.');
  }

  private mustStamp(value: string): string {
    const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    if (m) return `${m[1]}T${m[2]}`;
    throw new ToolError('invalid', `"${value}" is not a timestamp.`, 'Use YYYY-MM-DD HH:mm.');
  }

  /** Normalize and validate a field value, returning what should be written (or removed). */
  private coerceField(field: SetFieldName, value: string | string[]): string | string[] | undefined {
    if (field === 'tags') {
      const tags = normalizeTags(value);
      return tags?.length ? tags : undefined;
    }
    const raw = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    const trimmed = raw.trim();
    if (field === 'status') return this.mustLane(trimmed);
    if (field === 'title') {
      if (!trimmed) throw new ToolError('invalid', 'A task needs a title.');
      return trimmed;
    }
    if (!trimmed) return undefined; // clearing `due`
    if (field === 'due') return this.mustDue(trimmed);
    return trimmed;
  }
}

function normalizeTags(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((t) => String(t).trim()).filter(Boolean);
}

/** Most recently touched first — the order a planner should almost always default to. */
function byRecency(a: Task, b: Task): number {
  return a.derived.hoursSinceUpdate - b.derived.hoursSinceUpdate;
}
