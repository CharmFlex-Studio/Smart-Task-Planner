import type {
  AiStatus,
  Board,
  ChatMessage,
  WorkspaceSummary,
  ModelsView,
  ProposedChange,
  RepoFile,
  RepoSearchResult,
  Task,
  WriteResult,
} from '@shared/types.js';
import type { TodayView } from '../server/today.js';

/**
 * The HTTP client. Thin on purpose: every endpoint here maps to exactly one tool
 * operation on the server, so there is no place for the UI to invent its own rules about
 * what a valid change looks like.
 *
 * Every request carries the workspace the tab is looking at. It is held here rather than
 * threaded through every component because it is genuinely per-tab state — two windows can
 * sit in two workspaces — and because a request that forgets it would silently read the
 * wrong folder. One place to set it, one place that appends it.
 */

let workspace = '';

/** Point every subsequent request at a workspace. The empty id means the default one. */
export function setApiWorkspace(id: string): void {
  workspace = id;
}

function scoped(url: string): string {
  if (!workspace) return url;
  const [pathname = '', query] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('ws', workspace);
  return `${pathname}?${params.toString()}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${scoped(url)}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('The planner server is not responding.', 'offline');
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const err = body as { error?: string; code?: string; detail?: string };
    throw new ApiError(err.error ?? `Request failed (${res.status})`, err.code ?? 'internal', err.detail, res.status);
  }
  return body as T;
}

const post = <T,>(url: string, body?: unknown) =>
  request<T>(url, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const api = {
  health: () => request<{ ok: boolean; vault: string; tasks: number }>('/health'),

  tasks: (params: { status?: string; q?: string; archived?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    if (params.archived) qs.set('archived', '1');
    const suffix = qs.toString();
    return request<{ tasks: Task[] }>(`/tasks${suffix ? `?${suffix}` : ''}`);
  },

  task: (id: string) => request<{ task: Task; problems: string[] }>(`/tasks/${encodeURIComponent(id)}`),
  raw: (id: string) =>
    fetch(`/api${scoped(`/tasks/${encodeURIComponent(id)}/raw`)}`).then((r) => r.text()),
  today: () => request<TodayView>('/today'),
  search: (q: string) => request<{ matches: { task: Task; score: number }[] }>(`/search?q=${encodeURIComponent(q)}`),

  workspaces: () => request<{ workspaces: WorkspaceSummary[] }>('/workspaces'),
  addWorkspace: (name: string) => post<{ workspace: WorkspaceSummary }>('/workspaces', { name }),
  renameWorkspace: (id: string, name: string) =>
    request<{ workspace: WorkspaceSummary }>(`/workspaces/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  removeWorkspace: (id: string) =>
    request<{ ok: boolean }>(`/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  board: () => request<{ board: Board }>('/board'),
  addLane: (name: string, at?: number) =>
    post<{ board: Board }>('/board/lanes', { name, ...(at === undefined ? {} : { at }) }),
  updateLane: (id: string, patch: { name?: string; done?: boolean }) =>
    request<{ board: Board }>(`/board/lanes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  removeLane: (id: string, moveTo: string) =>
    request<{ board: Board; moved: number }>(
      `/board/lanes/${encodeURIComponent(id)}?moveTo=${encodeURIComponent(moveTo)}`,
      { method: 'DELETE' },
    ),
  reorderLanes: (ids: string[]) => post<{ board: Board }>('/board/lanes/order', { ids }),

  createTask: (body: Record<string, unknown>, dryRun = false) =>
    post<WriteResult>(`/tasks${dryRun ? '?dryRun=1' : ''}`, body),
  addLog: (id: string, body: { type?: string; text: string }, dryRun = false) =>
    post<WriteResult>(`/tasks/${encodeURIComponent(id)}/log${dryRun ? '?dryRun=1' : ''}`, body),
  setField: (id: string, field: string, value: string | string[]) =>
    request<WriteResult>(`/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ field, value }),
    }),
  archive: (id: string) => post<WriteResult>(`/tasks/${encodeURIComponent(id)}/archive`),
  restore: (id: string) => post<WriteResult>(`/tasks/${encodeURIComponent(id)}/restore`),
  remove: (id: string) => request<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  settings: () => request<{ settings: Settings; vault: string; version: string }>('/settings'),
  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  reload: () => post<{ ok: boolean; tasks: number }>('/reload'),
  history: () =>
    request<{
      repo: boolean;
      enabled: boolean;
      gitInstalled: boolean;
      commits: { hash: string; subject: string; date: string }[];
    }>('/history'),
  startHistory: () => post<{ ok: boolean; repo: boolean }>('/history/init'),
  revert: (hash: string) => post<{ ok: boolean }>(`/history/${hash}/revert`),

  aiStatus: () => request<{ status: AiStatus; unverifiedDownload: boolean }>('/ai/status'),
  aiModels: () => request<ModelsView>('/ai/models'),
  aiSearchRepos: (q: string) =>
    request<{ repos: RepoSearchResult[] }>(`/ai/models/search?q=${encodeURIComponent(q)}`),
  aiRepoFiles: (repo: string) =>
    request<{ repo: string; files: RepoFile[]; toolCalling: string }>(
      `/ai/models/files?repo=${encodeURIComponent(repo)}`,
    ),
  aiInstall: (repo: string | undefined, file: string) =>
    post<{ started: boolean }>('/ai/install', { ...(repo ? { repo } : {}), file }),
  aiRemoveModel: (file: string) =>
    request<{ ok: boolean }>(`/ai/models/${encodeURIComponent(file)}`, { method: 'DELETE' }),
  aiCancelInstall: () => post<{ ok: boolean }>('/ai/install/cancel'),
  aiStop: () => post<{ ok: boolean }>('/ai/stop'),
  chat: (text: string, history: ChatMessage[]) =>
    post<{ message: ChatMessage }>('/ai/chat', { text, history }),
  applyProposal: (id: string) => post<{ proposal: ProposedChange }>(`/ai/proposals/${id}/apply`),
  discardProposal: (id: string) => post<{ ok: boolean }>(`/ai/proposals/${id}/discard`),
};

export interface Settings {
  keepLoaded: boolean;
  idleTimeoutMs: number;
  autoApplyWrites: boolean;
  /** Downloaded .gguf filename, when we manage llama-server ourselves. */
  modelFile?: string;
  /** Model name on an external server (Ollama). */
  externalModel?: string;
  gitUndo: boolean;
}
