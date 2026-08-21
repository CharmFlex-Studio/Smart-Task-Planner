/**
 * The contract between the server and the web UI.
 *
 * Nothing here is persisted as-is: a Task is always a *projection* of one markdown
 * file in the vault. Derived signals (momentum, staleness, attention) are computed on
 * read and never stored, so they can never go stale or need a migration.
 */

/**
 * A workspace is a folder of the vault with its own tasks, its own board, and its own
 * scope for the assistant. The id is the folder name; the empty string is the vault root,
 * which stays a workspace so a vault written before workspaces existed keeps working and a
 * single-workspace user never gets a folder they did not ask for.
 */
export interface WorkspaceSummary {
  id: string;
  name: string;
  /** Open (unarchived) tasks in it — the switcher shows this. */
  taskCount: number;
}

/**
 * A board column. Lanes are user-defined: they live in the workspace's `board.md` and a
 * task's `status:` field holds a lane `id`. There is no fixed set of statuses.
 */
export interface Lane {
  /** Slug stored in a task's `status:` field. Stable across renames. */
  id: string;
  /** What the column header says. The only thing a rename changes. */
  name: string;
  /** The completion lane. Tasks here are finished; at most one lane is marked. */
  done?: boolean;
}

export interface Board {
  /** The workspace these lanes belong to. */
  workspace: string;
  lanes: Lane[];
  /** Non-fatal complaints about `board.md`, surfaced rather than swallowed. */
  problems: string[];
}

/**
 * Log entry types are still parsed and preserved so older vaults round-trip, but the UI
 * writes plain comments now: the lane says where work is, the comment says what happened.
 */
export const LOG_TYPES = [
  'progress',
  'discovery',
  'decision',
  'blocker',
  'note',
  'done',
] as const;
export type LogType = (typeof LOG_TYPES)[number];

/** One line of a task's story. Append-only: entries are never rewritten in place. */
export interface LogEntry {
  /** ISO-8601 local timestamp, minute precision (the file stores `YYYY-MM-DD HH:mm`). */
  at: string;
  type: LogType;
  text: string;
}

/** The structured half of a task file: its YAML frontmatter. */
export interface TaskFields {
  id: string;
  title: string;
  /** A lane id. Free-form, because lanes are the user's to name. */
  status: string;
  created: string;
  updated: string;
  due?: string;
  tags?: string[];
}

export const MOMENTUM = ['new', 'moving', 'slowing', 'stalled', 'done'] as const;
export type Momentum = (typeof MOMENTUM)[number];

/** Everything computed at read time from fields + log. Never written to disk. */
export interface DerivedSignals {
  momentum: Momentum;
  /** Whole hours since the newest log entry, or since `created` when there is none. */
  hoursSinceUpdate: number;
  /** Whole days until `due` — negative when overdue. */
  daysUntilDue?: number;
  overdue: boolean;
  /** Human-readable reasons this task wants attention. Empty means it does not. */
  attentionReasons: string[];
}

export interface Task {
  fields: TaskFields;
  /** Free prose between the frontmatter and the `## Log` heading. The task's description. */
  description: string;
  log: LogEntry[];
  derived: DerivedSignals;
  /** Vault-relative path, e.g. `tasks/improve-translation.md`. */
  path: string;
  archived: boolean;
}

/* ------------------------------------------------------------------ tools */

export type SetFieldName = 'title' | 'status' | 'due' | 'tags' | 'description';

export interface FileDiff {
  path: string;
  /** Unified diff of the change. Empty string when the write is a no-op. */
  patch: string;
  /** True when the file does not exist yet. */
  created: boolean;
}

/** Every write operation returns the task it would produce *and* the diff it would apply. */
export interface WriteResult {
  task: Task;
  diff: FileDiff;
  /** False for a dry run: nothing was written to disk. */
  applied: boolean;
}

/* ------------------------------------------------------------------- chat */

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ProposedChange {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  diff: FileDiff;
  summary: string;
  state: 'pending' | 'applied' | 'discarded' | 'failed';
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Read-only tool calls the assistant made while producing this message. */
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  /** Write tool calls, held for confirmation. */
  proposals?: ProposedChange[];
  createdAt: string;
}

/* --------------------------------------------------------------- ai plugin */

export const AI_STATES = [
  'not_installed',
  'downloading',
  'verifying',
  'smoke_testing',
  'ready',
  'starting',
  'running',
  'stopping',
  'error',
] as const;
export type AiState = (typeof AI_STATES)[number];

export interface AiStatus {
  state: AiState;
  /** `external` = an OpenAI-compatible server we did not start (Ollama). */
  mode: 'external' | 'managed';
  /** What to show the user: an Ollama model name, or a downloaded .gguf filename. */
  modelName?: string;
  runtimeInstalled: boolean;
  modelInstalled: boolean;
  /** 0..1 while downloading. */
  progress?: number;
  progressLabel?: string;
  error?: string;
  /** Loopback port llama-server is listening on, when running. */
  port?: number;
  /** Milliseconds until idle shutdown, when running. */
  idleMsRemaining?: number;
  keepLoaded: boolean;
}

/** A model already available on the connected server, or already downloaded here. */
export interface AvailableModel {
  /** Selection id: an Ollama model name, or a .gguf filename. */
  id: string;
  label: string;
  source: 'external' | 'downloaded';
  sizeBytes?: number;
  /** Rule of thumb from the parameter count in the name -- not a claim about this model. */
  toolCalling: 'unreliable' | 'workable' | 'reliable' | 'unknown';
}

export interface SuggestedRepo {
  repo: string;
  label: string;
  note: string;
}

export interface RepoSearchResult {
  repo: string;
  downloads: number;
  likes: number;
  toolCalling: 'unreliable' | 'workable' | 'reliable' | 'unknown';
}

/** One downloadable quantization of a repo, with its real size from the API. */
export interface RepoFile {
  file: string;
  sizeBytes: number;
  quant: string;
  recommended: boolean;
  split: boolean;
}

export interface ModelsView {
  available: AvailableModel[];
  suggested: SuggestedRepo[];
  selected?: string;
  /** True when an external server is configured, so downloading is not needed. */
  external: boolean;
  /** Set when the external server could not be listed. */
  externalError?: string;
}

/* ------------------------------------------------------------------ events */

export type VaultEvent =
  | { kind: 'task-changed'; path: string; task: Task }
  | { kind: 'task-removed'; path: string }
  | { kind: 'board-changed'; board: Board }
  | { kind: 'workspaces-changed'; workspaces: WorkspaceSummary[] }
  | { kind: 'reindexed'; count: number }
  | { kind: 'ai-status'; status: AiStatus };

/* ------------------------------------------------------------------ errors */

export interface ApiError {
  error: string;
  code:
    | 'not_found'
    | 'conflict'
    | 'invalid'
    | 'ai_unavailable'
    | 'internal';
  detail?: string;
}
