import React, { useMemo, useState } from 'react';
import { usePlanner } from '../state.js';
import { api } from '../api.js';
import { Empty, TaskCard } from './Bits.js';
import { laneName } from '../board.js';
import { Icon } from './Icon.js';

type Filter = 'open' | 'archived' | 'all' | string;

/** The full inventory, including everything the board hides. */
export function TaskList({ onOpen }: { onOpen(id: string): void }) {
  const { tasks, lanes } = usePlanner();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => (filter === 'archived' ? t.archived : filter === 'all' ? true : !t.archived))
      .filter((t) =>
        filter === 'open' || filter === 'all' || filter === 'archived'
          ? true
          : t.fields.status === filter,
      )
      .filter(
        (t) =>
          !q ||
          t.fields.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.log.some((e) => e.text.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.derived.hoursSinceUpdate - b.derived.hoursSinceUpdate);
  }, [tasks, lanes, filter, query]);

  const filters: { id: Filter; label: string }[] = [
    { id: 'open', label: 'Open' },
    ...lanes.map((lane) => ({ id: lane.id, label: lane.name })),
    { id: 'archived', label: 'Archived' },
    { id: 'all', label: 'Everything' },
  ];

  return (
    <>
      <div className="page-head">
        <h1>All tasks</h1>
        <span className="sub">{shown.length} shown</span>
      </div>

      <label className="search-field wide">
        <span className="sr-only">Filter tasks</span>
        <Icon name="search" size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, description or comment…"
        />
      </label>

      <div className="chips">
        {filters.map((f) => (
          <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <div className="rows">
          {shown.map((t) => (
            <TaskCard
              key={t.fields.id}
              task={t}
              laneName={laneName(lanes, t.fields.status)}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The vault's git history, which doubles as the undo list.
 *
 * When the vault is not a repository there is nothing to show, and the honest thing is to
 * say so and offer the one action that fixes it rather than render an empty list.
 */
export function History() {
  const { act } = usePlanner();
  const [state, setState] = useState<{
    repo: boolean;
    enabled: boolean;
    gitInstalled: boolean;
    commits: { hash: string; subject: string; date: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(() => {
    void api.history().then(setState);
  }, []);
  React.useEffect(load, [load]);

  const start = async () => {
    setBusy(true);
    await act(() => api.startHistory());
    setBusy(false);
    load();
  };

  const revert = async (hash: string) => {
    if (!confirm('Undo this change? It is applied as a new commit, so nothing is lost.')) return;
    await act(() => api.revert(hash));
    load();
  };

  return (
    <>
      <div className="page-head">
        <h1>History</h1>
        <span className="sub">every change, as a git commit</span>
      </div>

      {state && !state.enabled && (
        <div className="banner warn">
          <span>History is switched off in Settings, so changes are not being recorded.</span>
        </div>
      )}

      {state && state.enabled && !state.repo && (
        <div className="cta-card">
          <h2>This vault is not tracked yet</h2>
          <p>
            Turn it into a git repository and every change the planner makes becomes a commit you
            can read and undo. Nothing leaves your machine{state.gitInstalled ? '' : ' — but git is not installed, so this will not work yet'}.
          </p>
          <button className="btn" onClick={() => void start()} disabled={busy || !state.gitInstalled}>
            {busy ? 'Starting…' : 'Start tracking this vault'}
          </button>
        </div>
      )}

      {state?.repo && state.commits.length === 0 && (
        <Empty>No changes recorded yet. Edit a task and it will show up here.</Empty>
      )}

      <div className="rows">
        {state?.commits.map((commit) => (
          <div className="row-card static" key={commit.hash}>
            <div className="row-top">
              <span className="row-title">{describeCommit(commit.subject)}</span>
              <span className="spacer" />
              <button className="btn ghost small" onClick={() => void revert(commit.hash)}>
                Undo
              </button>
            </div>
            <div className="row-meta">
              <code>{commit.hash}</code>
              {commit.date ? ` · ${new Date(commit.date).toLocaleString()}` : ''}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Commit subjects are written by us and all start with the same prefix. */
function describeCommit(subject: string): string {
  return subject.replace(/^planner:\s*/, '');
}
