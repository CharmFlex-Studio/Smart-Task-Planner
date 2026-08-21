import { describe, expect, it } from 'vitest';
import type { Lane, Task } from '@shared/types.js';
import { boardTasks, buildColumns } from './board.js';

const LANES: Lane[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'in-progress', name: 'In Progress' },
  { id: 'done', name: 'Done', done: true },
];

function task(
  title: string,
  status: string,
  options: {
    archived?: boolean;
    description?: string;
    tags?: string[];
    comment?: string;
    hours?: number;
  } = {},
): Task {
  return {
    fields: {
      id: title,
      title,
      status,
      created: '2026-08-20T09:00',
      updated: '2026-08-20T09:00',
      ...(options.tags ? { tags: options.tags } : {}),
    },
    description: options.description ?? '',
    log: options.comment
      ? [{ at: '2026-08-20T09:00', type: 'note', text: options.comment }]
      : [],
    derived: {
      momentum: status === 'done' ? 'done' : 'moving',
      hoursSinceUpdate: options.hours ?? 1,
      overdue: false,
      attentionReasons: [],
    },
    path: `tasks/${title}.md`,
    archived: options.archived ?? false,
  };
}

describe('board projection', () => {
  it('gives every lane a column, empty ones included', () => {
    const columns = buildColumns([task('Build UI', 'in-progress')], LANES, '');
    expect(columns.map((c) => c.lane.id)).toEqual(['todo', 'in-progress', 'done']);
    expect(columns.map((c) => c.tasks.length)).toEqual([0, 1, 0]);
  });

  it('puts a task in the lane its file names', () => {
    const columns = buildColumns(
      [task('A', 'todo'), task('B', 'in-progress'), task('C', 'done')],
      LANES,
      '',
    );
    expect(columns.map((c) => c.tasks.map((t) => t.fields.title))).toEqual([['A'], ['B'], ['C']]);
  });

  it('falls back to the first lane for a task whose lane is gone', () => {
    const columns = buildColumns([task('Orphan', 'deleted-lane')], LANES, '');
    expect(columns[0]!.tasks.map((t) => t.fields.title)).toEqual(['Orphan']);
  });

  it('orders each column by most recent activity', () => {
    const columns = buildColumns(
      [task('Old', 'todo', { hours: 90 }), task('New', 'todo', { hours: 2 })],
      LANES,
      '',
    );
    expect(columns[0]!.tasks.map((t) => t.fields.title)).toEqual(['New', 'Old']);
  });

  it('excludes archived tasks and searches title, description, tags and comments', () => {
    const tasks = [
      task('Parser', 'todo', { description: 'Benchmark latency', tags: ['mobile'] }),
      task('Payments', 'in-progress', { comment: 'Merchant replied with logs' }),
      task('Old work', 'done', { archived: true, tags: ['mobile'] }),
    ];

    expect(boardTasks(tasks, 'mobile').map((t) => t.fields.title)).toEqual(['Parser']);
    expect(boardTasks(tasks, 'merchant').map((t) => t.fields.title)).toEqual(['Payments']);
    expect(boardTasks(tasks, 'latency').map((t) => t.fields.title)).toEqual(['Parser']);
    expect(boardTasks(tasks, '').map((t) => t.fields.title)).toEqual(['Parser', 'Payments']);
  });
});
