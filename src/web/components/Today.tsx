import React from 'react';
import { usePlanner } from '../state.js';
import { Empty, Section, TaskCard } from './Bits.js';
import { laneName } from '../board.js';

/**
 * "My work" answers three questions, in this order: what deserves attention, what was I
 * doing, and what changed. It is not a board — there is nothing to drag here. Every
 * grouping comes from the server's deterministic view, so it is instant and identical
 * every time it loads, with no model involved.
 */
export function Today({ onOpen }: { onOpen(id: string): void }) {
  const { today, lanes } = usePlanner();

  if (!today) return <Empty>Loading…</Empty>;

  const nothingAtAll = today.needsAttention.length === 0 && today.continueWith.length === 0;

  return (
    <>
      <div className="page-head">
        <h1>
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </h1>
        <span className="sub">{today.counts.updatedToday} touched today</span>
      </div>

      <div className="counts">
        <span><b>{today.counts.open}</b> open</span>
        <span><b>{today.counts.stale}</b> stalled</span>
        <span><b>{today.counts.done}</b> finished this week</span>
      </div>

      {nothingAtAll && (
        <Empty>
          Nothing open. Add a task on the board, or drop a markdown file into the vault folder
          and it will show up here.
        </Empty>
      )}

      {today.needsAttention.length > 0 && (
        <Section title="Needs attention">
          {today.needsAttention.map((t) => (
            <TaskCard
              key={t.fields.id}
              task={t}
              laneName={laneName(lanes, t.fields.status)}
              onOpen={onOpen}
            />
          ))}
        </Section>
      )}

      {today.continueWith.length > 0 && (
        <Section title="Continue">
          {today.continueWith.slice(0, 8).map((t) => (
            <TaskCard
              key={t.fields.id}
              task={t}
              laneName={laneName(lanes, t.fields.status)}
              onOpen={onOpen}
            />
          ))}
        </Section>
      )}

      {today.recent.length > 0 && (
        <Section title="Recent comments">
          {today.recent.map((item, i) => (
            <button className="row-card" key={`${item.task.id}-${i}`} onClick={() => onOpen(item.task.id)}>
              <div className="row-top">
                <span className="row-title">{item.task.title}</span>
                <span className="spacer" />
                <span className="row-meta">{item.entry.at.replace('T', ' ')}</span>
              </div>
              <div className="row-meta">{item.entry.text.split('\n')[0]}</div>
            </button>
          ))}
        </Section>
      )}
    </>
  );
}
