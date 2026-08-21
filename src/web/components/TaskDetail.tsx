import React, { useEffect, useRef, useState } from 'react';
import type { LogEntry, Task } from '@shared/types.js';
import { usePlanner } from '../state.js';
import { api } from '../api.js';
import { Empty, MomentumDot, ReasonPill, relativeTime } from './Bits.js';
import { Icon } from './Icon.js';

/**
 * One task, in full.
 *
 * Everything on this page is editable in place and each edit is one call to `setField`,
 * which rewrites one line of one file. There is no form to submit and nothing is staged:
 * leave a field and it is saved, which is the only model that matches a vault someone may
 * also be editing in another window.
 */
export function TaskDetail({ task, onBack }: { task: Task; onBack(): void }) {
  const { lanes, act } = usePlanner();
  const [showRaw, setShowRaw] = useState(false);
  const [raw, setRaw] = useState('');

  useEffect(() => {
    if (showRaw) void api.raw(task.fields.id).then(setRaw);
  }, [showRaw, task.fields.id, task.fields.updated]);

  const set = (field: string, value: string) =>
    act(() => api.setField(task.fields.id, field, value));

  return (
    <div className="detail-page">
      <header className="detail-head">
        <button className="back" onClick={onBack}>
          <span aria-hidden="true">←</span> Board
        </button>
        <span className="spacer" />
        <span className="task-path">{task.path}</span>
      </header>

      <div className="detail-layout">
        <section className="detail-main" aria-label="Task">
          <EditableTitle
            key={task.fields.id}
            value={task.fields.title}
            onSave={(value) => void set('title', value)}
          />

          <div className="detail-meta">
            <MomentumDot momentum={task.derived.momentum} />
            <span>Updated {relativeTime(task.derived.hoursSinceUpdate)}</span>
            {task.derived.attentionReasons.map((reason) => (
              <ReasonPill key={reason} reason={reason} />
            ))}
          </div>

          <Description
            key={`${task.fields.id}-description`}
            value={task.description}
            onSave={(value) => void set('description', value)}
          />

          <section className="comments" aria-label="Comments">
            <h2>
              <Icon name="comment" size={16} />
              Comments <span className="muted">{task.log.length}</span>
            </h2>
            <Composer taskId={task.fields.id} />
            <Timeline log={task.log} />
          </section>
        </section>

        <aside className="detail-side" aria-label="Details">
          <div className="side-card">
            <label htmlFor="task-lane">Lane</label>
            <select
              id="task-lane"
              value={lanes.some((lane) => lane.id === task.fields.status) ? task.fields.status : ''}
              onChange={(event) => void set('status', event.target.value)}
            >
              {!lanes.some((lane) => lane.id === task.fields.status) && (
                <option value="">{task.fields.status}</option>
              )}
              {lanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  {lane.name}
                </option>
              ))}
            </select>

            <label htmlFor="task-due">Due date</label>
            <div className="side-row">
              <input
                id="task-due"
                type="date"
                value={task.fields.due ?? ''}
                onChange={(event) => void set('due', event.target.value)}
              />
              {task.fields.due && (
                <button className="icon-btn" onClick={() => void set('due', '')} aria-label="Clear due date">
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>

            <dl className="side-facts">
              <dt>Created</dt>
              <dd>{shortDate(task.fields.created)}</dd>
              <dt>Updated</dt>
              <dd>{shortDate(task.fields.updated)}</dd>
            </dl>
          </div>

          <div className="side-actions">
            {task.archived ? (
              <button className="btn ghost" onClick={() => void act(() => api.restore(task.fields.id))}>
                Restore from archive
              </button>
            ) : (
              <button className="btn ghost" onClick={() => void act(() => api.archive(task.fields.id))}>
                <Icon name="check" size={15} /> Done &amp; archive
              </button>
            )}
            <button className="btn ghost" onClick={() => setShowRaw((value) => !value)}>
              {showRaw ? 'Hide' : 'Show'} markdown
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`Delete "${task.fields.title}"? The file is removed from the vault.`)) {
                  void act(() => api.remove(task.fields.id)).then(onBack);
                }
              }}
            >
              <Icon name="trash" size={15} /> Delete task
            </button>
          </div>
        </aside>
      </div>

      {showRaw && <pre className="raw">{raw}</pre>}
    </div>
  );
}

/* ------------------------------------------------------------------ fields */

function EditableTitle({ value, onSave }: { value: string; onSave(value: string): void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next) return setDraft(value);
    if (next !== value) onSave(next);
  };

  if (!editing) {
    return (
      <h1 className="detail-title">
        <button onClick={() => setEditing(true)} title="Click to rename">
          {value}
        </button>
      </h1>
    );
  }

  return (
    <h1 className="detail-title">
      <input
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label="Task title"
      />
    </h1>
  );
}

/**
 * The description is the prose in the markdown file, and it is edited as prose. There is no
 * "next action" field any more: one thing to write, in the place the file already keeps it.
 */
function Description({ value, onSave }: { value: string; onSave(value: string): void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft);
  };

  return (
    <section className="description">
      <h2>Description</h2>
      {editing ? (
        <>
          <textarea
            value={draft}
            autoFocus
            rows={Math.max(4, draft.split('\n').length + 1)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(value);
                setEditing(false);
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit();
            }}
            aria-label="Description"
          />
          <div className="row">
            <button className="btn" onClick={commit}>Save</button>
            <button
              className="btn ghost"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <span className="keyboard-hint">⌘↵</span>
          </div>
        </>
      ) : (
        <button className="description-body" onClick={() => setEditing(true)}>
          {value ? value : <span className="muted">Add a description…</span>}
        </button>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- comments */

/** Newest first, so a comment you just left is the one you see. */
function Timeline({ log }: { log: LogEntry[] }) {
  if (log.length === 0) {
    return <Empty>No comments yet.</Empty>;
  }
  const sorted = [...log].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="timeline">
      {sorted.map((entry, i) => (
        <article className="entry" key={`${entry.at}-${i}`}>
          <div className="entry-head">{formatStamp(entry.at)}</div>
          <div className="entry-text">{entry.text}</div>
        </article>
      ))}
    </div>
  );
}

function Composer({ taskId }: { taskId: string }) {
  const { act } = usePlanner();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await act(() => api.addLog(taskId, { text: value }));
    setBusy(false);
    if (ok) {
      setText('');
      box.current?.focus();
    }
  };

  return (
    <div className="composer">
      <textarea
        ref={box}
        id={`comment-${taskId}`}
        value={text}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
        }}
        placeholder="Add a comment…"
        aria-label="Add a comment"
      />
      <div className="row">
        <button className="btn" onClick={() => void submit()} disabled={!text.trim() || busy}>
          {busy ? 'Saving…' : 'Comment'}
        </button>
        <span className="keyboard-hint">⌘↵</span>
      </div>
    </div>
  );
}

function formatStamp(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at.replace('T', ' ');
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
