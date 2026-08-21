import { describe, expect, it } from 'vitest';
import { laneTally } from './context.js';
import type { Lane, Task } from '@shared/types.js';

const LANES: Lane[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'in-progress', name: 'In Progress' },
  { id: 'done', name: 'Done', done: true },
];

function task(id: string, status: string, archived = false): Task {
  return {
    path: `tasks/${id}.md`,
    archived,
    fields: { id, title: id, status, created: '2026-01-01', updated: '2026-01-01' },
    description: '',
    log: [],
    derived: {
      momentum: status === 'done' ? 'done' : 'new',
      hoursSinceUpdate: 1,
      overdue: false,
      attentionReasons: [],
    },
  } as Task;
}

describe('laneTally', () => {
  it('counts every lane the board names, including the done one', () => {
    const tally = laneTally(
      [task('a', 'todo'), task('b', 'todo'), task('c', 'in-progress'), task('d', 'done')],
      LANES,
    );
    expect(tally).toContain('- To Do: 2');
    expect(tally).toContain('- In Progress: 1');
    // The whole point: done tasks are absent from the index, so the tally must carry them.
    expect(tally).toContain('- Done: 1');
  });

  it('gives an empty lane a row of its own rather than omitting it', () => {
    // A missing row reads as "I was not told", which is what makes a model guess.
    expect(laneTally([task('a', 'todo')], LANES)).toContain('- In Progress: 0');
  });

  it('summarises open, done and total separately', () => {
    const tally = laneTally([task('a', 'todo'), task('b', 'done'), task('c', 'done')], LANES);
    expect(tally).toContain('1 open, 2 done, 3 on the board.');
  });

  it('leaves archived tasks out of the lanes and says how many there were', () => {
    const tally = laneTally([task('a', 'todo'), task('b', 'todo', true)], LANES);
    expect(tally).toContain('- To Do: 1');
    expect(tally).toContain('1 archived, not counted above.');
  });

  it('says nothing about archives when there are none', () => {
    expect(laneTally([task('a', 'todo')], LANES)).not.toContain('archived');
  });

  it('still counts a status no lane claims, so the rows add up to the total', () => {
    const tally = laneTally([task('a', 'todo'), task('b', 'someday')], LANES);
    expect(tally).toContain('- someday: 1');
    expect(tally).toContain('2 open, 0 done, 2 on the board.');
  });

  it('treats everything as open when the board marks no lane done', () => {
    const open: Lane[] = [{ id: 'now', name: 'Now' }];
    expect(laneTally([task('a', 'now')], open)).toContain('1 open, 0 done, 1 on the board.');
  });

  it('follows the done flag rather than the name "done"', () => {
    const renamed: Lane[] = [
      { id: 'done', name: 'Done Thinking' },
      { id: 'shipped', name: 'Shipped', done: true },
    ];
    const tally = laneTally([task('a', 'done'), task('b', 'shipped')], renamed);
    expect(tally).toContain('1 open, 1 done, 2 on the board.');
  });

  it('counts past the point where the index truncates', () => {
    // 60 open tasks: the index shows forty of them, the tally must still say sixty.
    const many = Array.from({ length: 60 }, (_, i) => task(`t${i}`, 'todo'));
    expect(laneTally(many, LANES)).toContain('- To Do: 60');
  });
});
