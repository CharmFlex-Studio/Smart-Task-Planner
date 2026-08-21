import React, { useEffect, useRef, useState } from 'react';
import { usePlanner } from '../state.js';
import { api } from '../api.js';
import { Icon } from './Icon.js';

/**
 * The workspace switcher.
 *
 * It sits at the top of the rail because a workspace decides what everything below it
 * means: which cards the board shows, and — the part worth being obvious about — what the
 * assistant can read.
 */
export function WorkspaceMenu() {
  const { workspaces, workspace, switchWorkspace, act, refresh } = usePlanner();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'new' | 'rename'>('menu');
  const [draft, setDraft] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) setMode('menu');
  }, [open]);

  const start = (next: 'new' | 'rename') => {
    setDraft(next === 'rename' ? (workspace?.name ?? '') : '');
    setMode(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    if (mode === 'new') {
      const created = await act(() => api.addWorkspace(name));
      if (created) {
        setOpen(false);
        switchWorkspace(created.workspace.id);
      }
      return;
    }
    if (workspace && (await act(() => api.renameWorkspace(workspace.id, name)))) setOpen(false);
  };

  const remove = async () => {
    if (!workspace) return;
    setOpen(false);
    const question =
      workspace.taskCount > 0
        ? `"${workspace.name}" still has ${workspace.taskCount} open ${workspace.taskCount === 1 ? 'task' : 'tasks'}. Delete it anyway?`
        : `Delete the empty workspace "${workspace.name}"? Its folder is removed from the vault.`;
    if (!confirm(question)) return;
    await act(() => api.removeWorkspace(workspace.id));
    // Whether it worked or not, the list decides where we are now: `refresh` moves this tab
    // to the first workspace when the one it was showing is gone.
    await refresh();
  };

  const label = workspace?.name ?? 'Loading…';

  return (
    <div className="workspace" ref={wrap}>
      <button
        className="workspace-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="workspace-mark">{initial(label)}</span>
        <span className="workspace-label">
          <strong>{label}</strong>
          <small>{workspace ? `${workspace.taskCount} open` : ''}</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>

      {open && (
        <div className="menu workspace-list" role="menu">
          {mode === 'menu' ? (
            <>
              {workspaces.map((item) => (
                <button
                  key={item.id}
                  role="menuitem"
                  className={item.id === workspace?.id ? 'on' : ''}
                  onClick={() => {
                    setOpen(false);
                    switchWorkspace(item.id);
                  }}
                >
                  <span>{item.name}</span>
                  <span className="count">{item.taskCount}</span>
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={() => start('new')}>New workspace…</button>
              <button role="menuitem" onClick={() => start('rename')} disabled={!workspace}>
                Rename this workspace
              </button>
              <button role="menuitem" className="danger" onClick={() => void remove()} disabled={!workspace}>
                Delete this workspace
              </button>
            </>
          ) : (
            <form className="workspace-new" onSubmit={submit}>
              <label htmlFor="workspace-name">
                {mode === 'new' ? 'Name the new workspace' : 'Rename this workspace'}
              </label>
              <input
                id="workspace-name"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setMode('menu');
                }}
                placeholder="Client work"
              />
              <div className="row">
                <button className="btn" type="submit" disabled={!draft.trim()}>
                  {mode === 'new' ? 'Create' : 'Save'}
                </button>
                <button className="btn ghost" type="button" onClick={() => setMode('menu')}>
                  Cancel
                </button>
              </div>
              {mode === 'new' && (
                <small>
                  A folder in the vault, with its own board and its own tasks. The assistant
                  only ever reads the workspace you are in.
                </small>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function initial(name: string): string {
  return (name.trim()[0] ?? 'P').toUpperCase();
}
