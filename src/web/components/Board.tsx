import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Lane, Task } from '@shared/types.js';
import { usePlanner } from '../state.js';
import { api } from '../api.js';
import { buildColumns } from '../board.js';
import { Icon } from './Icon.js';
import { plainText } from '../markdown.js';
import { DueChip, relativeTime } from './Bits.js';

/**
 * The board.
 *
 * Columns are the lanes in `board.md`; a card is one markdown file. Dragging a card writes
 * one frontmatter line and nothing else, which is why the board can be this direct: there
 * is no ordering state to keep, no cache to invalidate, and no second source of truth to
 * disagree with the files.
 */
export function Board({ onOpen }: { onOpen(id: string): void }) {
  const { tasks, lanes, boardProblems, act } = usePlanner();
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const columns = useMemo(() => buildColumns(tasks, lanes, query), [tasks, lanes, query]);
  const shown = columns.reduce((count, column) => count + column.tasks.length, 0);
  const total = tasks.filter((task) => !task.archived).length;

  const move = async (taskId: string, laneId: string) => {
    const task = tasks.find((t) => t.fields.id === taskId);
    if (!task || task.fields.status === laneId) return;
    await act(() => api.setField(taskId, 'status', laneId));
  };

  const drop = (laneId: string) => (event: React.DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/task-id') || dragging;
    setOver(null);
    setDragging(null);
    if (id) void move(id, laneId);
  };

  return (
    <div className="board-page">
      <header className="board-head">
        <div>
          <h1>Board</h1>
          <p>
            {query ? `${shown} of ${total} tasks match` : `${total} open ${total === 1 ? 'task' : 'tasks'}`}
          </p>
        </div>
        <label className="search-field">
          <span className="sr-only">Filter the board</span>
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter tasks"
          />
          {query && (
            <button className="clear" onClick={() => setQuery('')} aria-label="Clear filter">
              <Icon name="x" size={14} />
            </button>
          )}
        </label>
      </header>

      {boardProblems.length > 0 && (
        <div className="banner warn">
          <span>{boardProblems.join(' ')}</span>
        </div>
      )}

      <div className="board" aria-label="Task board">
        {columns.map((column, index) => (
          <section
            key={column.lane.id}
            className={`lane ${over === column.lane.id ? 'drop' : ''} ${column.lane.done ? 'is-done' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.lane.id);
            }}
            onDragLeave={() => setOver((current) => (current === column.lane.id ? null : current))}
            onDrop={drop(column.lane.id)}
          >
            <LaneHeader
              lane={column.lane}
              lanes={lanes}
              index={index}
              count={column.tasks.length}
            />

            <div className="lane-cards">
              {column.tasks.map((task) => (
                <BoardCard
                  key={task.fields.id}
                  task={task}
                  dragging={dragging === task.fields.id}
                  onOpen={onOpen}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/task-id', task.fields.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragging(task.fields.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
              {column.tasks.length === 0 && (
                <p className="lane-empty">{query ? 'No matches' : 'Nothing here'}</p>
              )}
            </div>

            <NewCard lane={column.lane} />
          </section>
        ))}

        <div className="lane-add">
          {adding ? (
            <NewLane onDone={() => setAdding(false)} />
          ) : (
            <button className="btn ghost" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Add lane
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ lanes */

function LaneHeader({
  lane,
  lanes,
  index,
  count,
}: {
  lane: Lane;
  lanes: Lane[];
  index: number;
  count: number;
}) {
  const { act } = usePlanner();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(lane.name);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setName(lane.name), [lane.name]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const rename = async () => {
    const value = name.trim();
    setRenaming(false);
    if (!value || value === lane.name) {
      setName(lane.name);
      return;
    }
    await act(() => api.updateLane(lane.id, { name: value }));
  };

  const reorder = (to: number) => {
    const ids = lanes.map((l) => l.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved!);
    setMenu(false);
    void act(() => api.reorderLanes(ids));
  };

  const remove = () => {
    setMenu(false);
    const elsewhere = lanes.filter((l) => l.id !== lane.id);
    const destination = lanes[index - 1] ?? elsewhere[0];
    if (!destination) return;
    const question = count
      ? `Delete "${lane.name}" and move its ${count} ${count === 1 ? 'task' : 'tasks'} to "${destination.name}"?`
      : `Delete the empty lane "${lane.name}"?`;
    if (confirm(question)) void act(() => api.removeLane(lane.id, destination.id));
  };

  return (
    <header className="lane-head">
      {renaming ? (
        <input
          className="lane-rename"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setName(lane.name);
              setRenaming(false);
            }
          }}
          aria-label={`Rename ${lane.name}`}
        />
      ) : (
        <button className="lane-name" onClick={() => setRenaming(true)} title="Rename this lane">
          {lane.name}
          {lane.done && <Icon name="check" size={13} />}
        </button>
      )}
      <span className="lane-count">{count}</span>

      <div className="lane-menu" ref={menuRef}>
        <button
          className="icon-btn"
          onClick={() => setMenu((open) => !open)}
          aria-label={`Lane options for ${lane.name}`}
          aria-expanded={menu}
        >
          <Icon name="more" size={16} />
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setRenaming(true);
              }}
            >
              Rename
            </button>
            <button role="menuitem" disabled={index === 0} onClick={() => reorder(index - 1)}>
              Move left
            </button>
            <button
              role="menuitem"
              disabled={index === lanes.length - 1}
              onClick={() => reorder(index + 1)}
            >
              Move right
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(false);
                void act(() => api.updateLane(lane.id, { done: !lane.done }));
              }}
            >
              {lane.done ? 'Not the done lane' : 'Mark as done lane'}
            </button>
            <button role="menuitem" className="danger" disabled={lanes.length < 2} onClick={remove}>
              Delete lane
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function NewLane({ onDone }: { onDone(): void }) {
  const { act } = usePlanner();
  const [name, setName] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return onDone();
    const ok = await act(() => api.addLane(value));
    if (ok) onDone();
  };

  return (
    <form className="lane-new" onSubmit={submit}>
      <input
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
        placeholder="Lane name"
        aria-label="New lane name"
      />
      <div className="row">
        <button className="btn" type="submit" disabled={!name.trim()}>Add</button>
        <button className="btn ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ cards */

/** Inline creation, Jira-style: the composer stays open so several cards can go in at once. */
function NewCard({ lane }: { lane: Lane }) {
  const { act } = usePlanner();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const create = async () => {
    const value = title.trim();
    if (!value) return;
    await act(() => api.createTask({ title: value, status: lane.id }));
    setTitle('');
  };

  if (!open) {
    return (
      <button className="lane-create" onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} /> Create
      </button>
    );
  }

  return (
    <form
      className="card-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <textarea
        value={title}
        autoFocus
        rows={2}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void create();
          }
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder="What needs doing?"
        aria-label={`New task in ${lane.name}`}
      />
      <div className="row">
        <button className="btn" type="submit" disabled={!title.trim()}>Create</button>
        <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

function BoardCard({
  task,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  dragging: boolean;
  onOpen(id: string): void;
  onDragStart(event: React.DragEvent): void;
  onDragEnd(): void;
}) {
  const comments = task.log.length;

  return (
    <article
      className={`card ${dragging ? 'dragging' : ''} ${task.derived.momentum === 'done' ? 'done' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button className="card-open" onClick={() => onOpen(task.fields.id)}>
        <span className="card-title">{task.fields.title}</span>
        {task.description && <span className="card-desc">{firstLine(task.description)}</span>}
      </button>
      <footer className="card-foot">
        {task.derived.attentionReasons[0] && (
          <span className={`chip ${task.derived.overdue ? 'red' : 'amber'}`}>
            {task.derived.attentionReasons[0]}
          </span>
        )}
        <DueChip task={task} />
        <span className="spacer" />
        {comments > 0 && (
          <span className="card-stat" title={`${comments} ${comments === 1 ? 'comment' : 'comments'}`}>
            <Icon name="comment" size={13} /> {comments}
          </span>
        )}
        <span className="card-age">{relativeTime(task.derived.hoursSinceUpdate)}</span>
      </footer>
    </article>
  );
}

/** The first line of prose, with its markdown reduced to the words in it. */
function firstLine(text: string): string {
  const line = plainText(text)
    .split('\n')
    .find((l) => l.trim());
  return (line ?? '').trim();
}
