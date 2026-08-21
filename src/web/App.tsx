import React, { useEffect, useState } from 'react';
import { usePlanner, useTask } from './state.js';
import { Today } from './components/Today.js';
import { Board } from './components/Board.js';
import { TaskList, History } from './components/TaskList.js';
import { TaskDetail } from './components/TaskDetail.js';
import { Setup } from './components/Setup.js';
import { Chat } from './components/Chat.js';
import { Palette } from './components/Palette.js';
import { WorkspaceMenu } from './components/WorkspaceMenu.js';
import { Icon, type IconName } from './components/Icon.js';

type View = 'board' | 'today' | 'tasks' | 'history' | 'setup';

export function App() {
  const { tasks, today, error, setError, connected, vaultPath, version, loading } = usePlanner();
  const [view, setView] = useState<View>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(() => window.matchMedia('(min-width: 1181px)').matches);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openTask = useTask(openId);

  // A task can vanish underneath us if the file is deleted outside the app.
  useEffect(() => {
    if (openId && !loading && !tasks.some((t) => t.fields.id === openId)) setOpenId(null);
  }, [openId, tasks, loading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const show = (id: string) => {
    setOpenId(id);
  };

  const go = (next: View) => {
    setOpenId(null);
    setView(next);
  };

  const attention = today?.needsAttention.length ?? 0;

  return (
    <div className={chatOpen ? 'shell with-chat' : 'shell'}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <nav className="rail">
        <div className="wordmark">watsmytask</div>
        <WorkspaceMenu />

        <div className="nav primary-nav" aria-label="Workspace">
          <NavButton icon="board" label="Board" active={view === 'board' && !openId} current count={tasks.filter((t) => !t.archived).length} onClick={() => go('board')} />
          <NavButton icon="spark" label="My work" active={view === 'today' && !openId} current count={attention || undefined} onClick={() => go('today')} />
          <NavButton icon="tasks" label="All tasks" active={view === 'tasks' && !openId} current onClick={() => go('tasks')} />
          <NavButton icon="history" label="History" active={view === 'history' && !openId} current onClick={() => go('history')} />
        </div>

        <div className="nav utility-nav" aria-label="Tools">
          <NavButton icon="search" label="Search" count="⌘K" onClick={() => setPaletteOpen(true)} />
          <NavButton icon="chat" label="AI assistant" active={chatOpen} onClick={() => setChatOpen((v) => !v)} />
          <NavButton icon="settings" label="Settings" active={view === 'setup' && !openId} current onClick={() => go('setup')} />
        </div>

        <div className="rail-foot">
          <div>
            <span className={connected ? 'dot-live' : 'dot-live off'} />{' '}
            {connected ? 'watching vault' : 'reconnecting…'}
          </div>
          <div className="vault-path">{vaultPath}</div>
          {version && <div className="rail-version">watsmytask {version}</div>}
        </div>
      </nav>

      <main id="main-content" className={`main ${view === 'board' && !openId ? 'board-main' : ''}`} tabIndex={-1}>
        {error && (
          <div className="banner error">
            <span>{error}</span>
            <span className="spacer" />
            <button onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {openTask ? (
          <TaskDetail task={openTask} onBack={() => setOpenId(null)} />
        ) : view === 'board' ? (
          <Board onOpen={show} />
        ) : view === 'today' ? (
          <Today onOpen={show} />
        ) : view === 'tasks' ? (
          <TaskList onOpen={show} />
        ) : view === 'history' ? (
          <History />
        ) : (
          <Setup />
        )}
      </main>

      {chatOpen && <Chat onOpenSetup={() => go('setup')} onClose={() => setChatOpen(false)} />}

      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} onOpenTask={show} />
    </div>
  );
}

function NavButton({
  icon,
  label,
  active = false,
  current = false,
  count,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  current?: boolean;
  count?: string | number;
  onClick(): void;
}) {
  return (
    <button
      className={active ? 'on' : ''}
      onClick={onClick}
      aria-current={current && active ? 'page' : undefined}
      aria-pressed={!current ? active : undefined}
    >
      <span className="nav-label"><Icon name={icon} /><span>{label}</span></span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}
