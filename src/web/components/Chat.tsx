import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage, FileDiff, ProposedChange } from '@shared/types.js';
import { usePlanner } from '../state.js';
import { api, ApiError } from '../api.js';
import { Icon } from './Icon.js';

/**
 * The chat panel.
 *
 * The important thing on this screen is not the prose the model writes -- it is the diff
 * cards. A write tool call arrives here as a proposed change to a specific file with
 * Apply / Discard next to it, so the model's job is only ever to *draft*. That is the
 * whole reason a small local model is good enough to be useful here.
 */
export function Chat({ onOpenSetup, onClose }: { onOpenSetup(): void; onClose(): void }) {
  const { ai, workspace, refresh } = usePlanner();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const installed = ai?.runtimeInstalled && ai?.modelInstalled;

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: value,
      createdAt: new Date().toISOString(),
    };
    const history = messages;
    setMessages([...history, user]);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const { message } = await api.chat(value, history);
      setMessages((prev) => [...prev, message]);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, err.detail].filter(Boolean).join(' ') : String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateProposal = (id: string, patch: Partial<ProposedChange>) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.proposals?.some((p) => p.id === id)
          ? { ...m, proposals: m.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
          : m,
      ),
    );
  };

  return (
    <aside className="chat">
      <div className="chat-head">
        <span className="chat-title">
          <Icon name="spark" size={16} />
          <span>
            <strong>AI assistant</strong>
            {/* Saying what it can read, where it can be read, beats a promise in a README. */}
            {workspace && <small>reads {workspace.name} only</small>}
          </span>
        </span>
        <span className="spacer" />
        <AiBadge onOpenSetup={onOpenSetup} />
        <button className="icon-btn" onClick={onClose} aria-label="Close AI assistant">
          <Icon name="x" size={17} />
        </button>
      </div>

      <div className="chat-log" ref={logRef}>
        {!installed && (
          <div className="banner info">
            <span>
              Local AI is not installed. The planner works fine without it —{' '}
              <button onClick={onOpenSetup}>set it up</button> when you want a chat that can read
              and draft changes to your tasks.
            </span>
          </div>
        )}
        {installed && messages.length === 0 && (
          <div className="banner info">
            <span>
              Try: <em>what am I blocked on?</em> · <em>where did I leave off on the payment
              work?</em> · <em>note that I finished the parser</em>
            </span>
          </div>
        )}

        {messages.map((message) => (
          <Bubble key={message.id} message={message} onUpdate={updateProposal} />
        ))}

        {busy && <div className="tool-note">thinking…</div>}
        {error && <div className="banner error">{error}</div>}
      </div>

      <div className="chat-foot">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={installed ? 'Ask, or say what you just did…' : 'Install a model to chat'}
          disabled={!installed || busy}
        />
      </div>
    </aside>
  );
}

function AiBadge({ onOpenSetup }: { onOpenSetup(): void }) {
  const { ai } = usePlanner();
  if (!ai) return null;
  const tone =
    ai.state === 'running' ? 'green' : ai.state === 'error' ? 'red' : ai.state === 'downloading' ? 'amber' : '';
  const label =
    ai.state === 'running'
      ? 'model loaded'
      : ai.state === 'ready'
        ? 'model idle'
        : ai.state === 'starting'
          ? 'loading model…'
          : ai.state === 'downloading'
            ? 'downloading'
            : ai.state === 'not_installed'
              ? 'not installed'
              : ai.state;
  return (
    <button className={`pill ${tone}`} onClick={onOpenSetup} style={{ cursor: 'pointer', border: 'none' }}>
      {label}
    </button>
  );
}

function Bubble({
  message,
  onUpdate,
}: {
  message: ChatMessage;
  onUpdate(id: string, patch: Partial<ProposedChange>): void;
}) {
  if (message.role === 'user') {
    return (
      <div className="bubble user">
        <div className="text">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="bubble assistant">
      <div className="who">planner</div>
      <div className="text">{message.content}</div>
      {message.toolCalls?.length ? (
        <div className="tool-note">read: {message.toolCalls.map((c) => c.name).join(', ')}</div>
      ) : null}
      {message.proposals?.map((p) => (
        <Proposal key={p.id} proposal={p} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

/**
 * A proposed change. Nothing has touched the disk when this renders -- the server built
 * the diff from a dry run. Apply re-runs the tool for real, and if the file moved on in
 * the meantime the server refuses and shows the new diff instead of silently overwriting.
 */
function Proposal({
  proposal,
  onUpdate,
}: {
  proposal: ProposedChange;
  onUpdate(id: string, patch: Partial<ProposedChange>): void;
}) {
  const { refresh } = usePlanner();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const apply = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { proposal: applied } = await api.applyProposal(proposal.id);
      onUpdate(proposal.id, { state: 'applied', diff: applied.diff });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNote('The file changed since this was drafted. Review the updated diff and apply again.');
      } else {
        onUpdate(proposal.id, { state: 'failed', error: err instanceof ApiError ? err.message : String(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    await api.discardProposal(proposal.id).catch(() => {});
    onUpdate(proposal.id, { state: 'discarded' });
  };

  return (
    <div className={`proposal ${proposal.state}`}>
      <div className="proposal-head">
        {proposal.summary}
        <span className="path">{proposal.diff.path}</span>
      </div>
      <DiffView diff={proposal.diff} />
      {note && <div className="banner warn" style={{ margin: 0, borderRadius: 0 }}>{note}</div>}
      {proposal.error && <div className="banner error" style={{ margin: 0, borderRadius: 0 }}>{proposal.error}</div>}
      <div className="proposal-actions">
        {proposal.state === 'pending' ? (
          <>
            <button className="btn small" onClick={() => void apply()} disabled={busy}>
              Apply
            </button>
            <button className="btn ghost small" onClick={() => void discard()} disabled={busy}>
              Discard
            </button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {proposal.state === 'applied'
              ? 'Applied to the vault'
              : proposal.state === 'discarded'
                ? 'Discarded'
                : 'Failed'}
          </span>
        )}
      </div>
    </div>
  );
}

export function DiffView({ diff }: { diff: FileDiff }) {
  const lines = diff.patch.split('\n').filter((l) => !l.startsWith('---') && !l.startsWith('+++'));
  if (lines.length === 0) return <div className="diff"><div className="ctx">No change.</div></div>;
  return (
    <div className="diff">
      {lines.map((line, i) => {
        const cls = line.startsWith('+')
          ? 'add'
          : line.startsWith('-')
            ? 'del'
            : line.startsWith('@@')
              ? 'hunk'
              : 'ctx';
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
}
