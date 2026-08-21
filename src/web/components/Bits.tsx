import React from 'react';
import type { Momentum, Task } from '@shared/types.js';
import { Icon } from './Icon.js';

/** Small shared pieces. Kept together because each is a handful of lines. */

export function MomentumDot({ momentum, title }: { momentum: Momentum; title?: string }) {
  return <span className={`mdot ${momentum}`} title={title ?? momentum} />;
}

export function Pill({
  children,
  tone = 'plain',
}: {
  children: React.ReactNode;
  tone?: 'plain' | 'red' | 'amber' | 'green' | 'accent';
}) {
  return <span className={`pill ${tone === 'plain' ? '' : tone}`}>{children}</span>;
}

/** Attention reasons carry their own urgency, so the colour is picked from the words. */
export function ReasonPill({ reason }: { reason: string }) {
  const tone = /overdue/i.test(reason) ? 'red' : /due|no update/i.test(reason) ? 'amber' : 'plain';
  return <Pill tone={tone}>{reason}</Pill>;
}

export function DueChip({ task }: { task: Task }) {
  if (!task.fields.due) return null;
  return (
    <span className={`chip ${task.derived.overdue ? 'red' : ''}`}>
      <Icon name="calendar" size={12} /> {task.fields.due}
    </span>
  );
}

export function relativeTime(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function describeTask(task: Task): string {
  const bits = [`Touched ${relativeTime(task.derived.hoursSinceUpdate)}`];
  if (task.log.length) bits.push(`${task.log.length} comment${task.log.length === 1 ? '' : 's'}`);
  if (task.fields.due) bits.push(`due ${task.fields.due}`);
  return bits.join(' · ');
}

export function TaskCard({
  task,
  laneName,
  onOpen,
}: {
  task: Task;
  laneName?: string;
  onOpen(id: string): void;
}) {
  return (
    <button className="row-card" onClick={() => onOpen(task.fields.id)}>
      <div className="row-top">
        <MomentumDot momentum={task.derived.momentum} />
        <span className="row-title">{task.fields.title}</span>
        {laneName && <Pill tone={task.derived.momentum === 'done' ? 'green' : 'accent'}>{laneName}</Pill>}
      </div>
      <div className="row-meta">{describeTask(task)}</div>
      {task.derived.attentionReasons.length > 0 && (
        <div className="reasons">
          {task.derived.attentionReasons.map((reason) => (
            <ReasonPill key={reason} reason={reason} />
          ))}
        </div>
      )}
    </button>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
