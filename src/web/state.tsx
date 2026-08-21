import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AiStatus, Board, Lane, Task, VaultEvent, WorkspaceSummary } from '@shared/types.js';
import type { TodayView } from '../server/today.js';
import { api, ApiError, setApiWorkspace, type Settings } from './api.js';

/** Remembering the open workspace is a property of this tab, so it lives in the browser. */
const WORKSPACE_KEY = 'planner.workspace';

function rememberedWorkspace(): string {
  try {
    return window.localStorage.getItem(WORKSPACE_KEY) ?? '';
  } catch {
    return '';
  }
}

function remember(id: string): void {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    /* private browsing: the choice just does not survive a reload */
  }
}

/**
 * All the app's state, in one place.
 *
 * Deliberately a context and a `useState` rather than a state library. The data is a list
 * of tasks and a couple of status objects; the server is the source of truth and pushes
 * changes over SSE. Adding a store here would be ceremony around a Map.
 */

interface PlannerState {
  /** Every workspace in the vault — the switcher's list, and nothing more. */
  workspaces: WorkspaceSummary[];
  /** The one this tab is looking at. Every request is scoped to it. */
  workspace: WorkspaceSummary | null;
  switchWorkspace(id: string): void;
  tasks: Task[];
  /** The board's columns, in order. Never empty once loaded. */
  lanes: Lane[];
  boardProblems: string[];
  today: TodayView | null;
  settings: Settings | null;
  vaultPath: string;
  version: string;
  ai: AiStatus | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  setError(message: string | null): void;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  /** Run an action and refresh, turning any failure into a visible message. */
  act<T>(fn: () => Promise<T>): Promise<T | undefined>;
}

const Ctx = createContext<PlannerState | null>(null);

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>(() => {
    const stored = rememberedWorkspace();
    setApiWorkspace(stored);
    return stored;
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [board, setBoard] = useState<Board>({ workspace: '', lanes: [], problems: [] });
  const [today, setToday] = useState<TodayView | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [vaultPath, setVaultPath] = useState('');
  const [version, setVersion] = useState('');
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshing = useRef(false);
  /** The workspace the next request will use — a ref so `refresh` never reads a stale one. */
  const current = useRef(workspaceId);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      // The workspace list first: if the one this tab remembers is gone, every other
      // request would 404, so fall back before making them.
      const { workspaces: list } = await api.workspaces();
      setWorkspaces(list);
      if (list.length > 0 && !list.some((w) => w.id === current.current)) {
        current.current = list[0]!.id;
        setApiWorkspace(current.current);
        setWorkspaceId(current.current);
        remember(current.current);
      }

      const [taskList, boardView, todayView, aiStatus] = await Promise.all([
        api.tasks({ archived: true }),
        api.board(),
        api.today(),
        api.aiStatus(),
      ]);
      setTasks(taskList.tasks);
      setBoard(boardView.board);
      setToday(todayView);
      setAi(aiStatus.status);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, []);

  /**
   * Switch workspace. The old workspace's tasks are dropped rather than left on screen:
   * showing one workspace's cards under another's name, even for a moment, is exactly the
   * confusion this feature exists to prevent.
   */
  const switchWorkspace = useCallback(
    (id: string) => {
      if (id === current.current) return;
      current.current = id;
      setApiWorkspace(id);
      setWorkspaceId(id);
      remember(id);
      setTasks([]);
      setToday(null);
      setBoard({ workspace: id, lanes: [], problems: [] });
      setLoading(true);
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.settings();
        setSettings(s.settings);
        setVaultPath(s.vault);
        setVersion(s.version ?? '');
      } catch {
        /* refresh() will surface the failure */
      }
      await refresh();
    })();
  }, [refresh]);

  // The live connection. Any vault event just triggers a refresh: the payloads are small,
  // the server is local, and "recompute everything" is far easier to keep correct than a
  // hand-merged cache.
  useEffect(() => {
    const source = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | undefined;

    const nudge = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 80);
    };

    source.addEventListener('ready', () => setConnected(true));
    source.addEventListener('vault', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as VaultEvent;
      if (payload.kind === 'ai-status') setAi(payload.status);
      else nudge();
    });
    source.onerror = () => setConnected(false);
    source.onopen = () => setConnected(true);

    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [refresh]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.saveSettings(patch);
    setSettings(next.settings);
  }, []);

  const act = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        const result = await fn();
        setError(null);
        await refresh();
        return result;
      } catch (err) {
        setError(
          err instanceof ApiError
            ? [err.message, err.detail].filter(Boolean).join(' ')
            : String(err),
        );
        await refresh();
        return undefined;
      }
    },
    [refresh],
  );

  const value = useMemo<PlannerState>(
    () => ({
      workspaces,
      workspace: workspaces.find((w) => w.id === workspaceId) ?? null,
      switchWorkspace,
      tasks,
      lanes: board.lanes,
      boardProblems: board.problems,
      today,
      settings,
      vaultPath,
      version,
      ai,
      connected,
      loading,
      error,
      refresh,
      setError,
      saveSettings,
      act,
    }),
    [
      workspaces,
      workspaceId,
      switchWorkspace,
      tasks,
      board,
      today,
      settings,
      vaultPath,
      version,
      ai,
      connected,
      loading,
      error,
      refresh,
      saveSettings,
      act,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): PlannerState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlanner must be used inside PlannerProvider');
  return ctx;
}

export function useTask(id: string | null): Task | undefined {
  const { tasks } = usePlanner();
  return useMemo(() => tasks.find((t) => t.fields.id === id), [tasks, id]);
}
