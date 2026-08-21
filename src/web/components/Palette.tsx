import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@shared/types.js';
import { usePlanner } from '../state.js';
import { api } from '../api.js';
import { MomentumDot } from './Bits.js';
import { laneName } from '../board.js';

/**
 * The command palette (⌘K).
 *
 * This exists because the chatbot must never be the fastest way to do a simple thing.
 * "Mark X done" is two keystrokes here and a sentence plus a model round-trip plus an
 * approval there. Keeping the deterministic path quick is what stops the AI from becoming
 * load-bearing.
 */

interface Action {
  label: string;
  hint?: string;
  run(): void | Promise<unknown>;
  task?: Task;
}

export function Palette({
  open,
  onClose,
  onOpenTask,
}: {
  open: boolean;
  onClose(): void;
  onOpenTask(id: string): void;
}) {
  const { tasks, lanes, act } = usePlanner();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const actions = useMemo<Action[]>(() => {
    const q = query.trim();
    const lower = q.toLowerCase();
    const live = tasks.filter((t) => !t.archived);

    const matched = live
      .filter((t) => !q || t.fields.title.toLowerCase().includes(lower))
      .sort((a, b) => a.derived.hoursSinceUpdate - b.derived.hoursSinceUpdate)
      .slice(0, 8);

    const list: Action[] = matched.map((task) => ({
      label: task.fields.title,
      hint: laneName(lanes, task.fields.status),
      task,
      run: () => onOpenTask(task.fields.id),
    }));

    if (q) {
      list.unshift({
        label: `Create task "${q}"`,
        hint: 'new',
        run: async () => {
          const result = await act(() => api.createTask({ title: q }));
          if (result) onOpenTask(result.task.fields.id);
        },
      });
    }
    return list;
  }, [query, tasks, lanes, act, onOpenTask]);

  if (!open) return null;

  const choose = (action: Action | undefined) => {
    if (!action) return;
    onClose();
    void action.run();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, actions.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter') choose(actions[index]);
          }}
          placeholder="Find a task, or type a new one…"
          aria-label="Command palette"
        />
        {actions.length === 0 ? (
          <div className="empty">No tasks yet. Type a title to create one.</div>
        ) : (
          <ul>
            {actions.map((action, i) => (
              <li
                key={`${action.label}-${i}`}
                className={i === index ? 'on' : ''}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(action)}
              >
                {action.task ? <MomentumDot momentum={action.task.derived.momentum} /> : <span className="mdot new" />}
                <span>{action.label}</span>
                {action.hint && <span className="hint">{action.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
