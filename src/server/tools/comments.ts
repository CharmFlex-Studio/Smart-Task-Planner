/**
 * Editing and removing a comment: the write path for entries under `## Log`.
 *
 * Deliberately outside the seven task tools, for the reason `lanes.ts` is: those double
 * as the model's schema and every extra entry there costs accuracy. These are UI-only,
 * and the assistant is not given them on purpose — it can add a comment, and it has no
 * way to go back and rewrite or delete one. A log is a record of what happened, and a
 * model quietly editing history is not a feature anyone asked for.
 *
 * An edit changes the text and nothing else. The timestamp stays as it was, because the
 * entry still records when the thing happened, not when the wording was fixed.
 */

import type { Task } from '@shared/types.js';
import type { VaultStore } from '../vault/store.js';
import {
  logEntryRanges,
  removeLogEntry,
  replaceLogEntry,
  setFrontmatterField,
} from '../vault/markdown.js';
import { localIso } from './time.js';
import { ToolError } from './errors.js';

export class CommentTools {
  constructor(
    private readonly store: VaultStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Entries are addressed by their position in the file, counting from the top.
   *
   * Not by timestamp: two comments a minute apart round to the same stamp, and two
   * comments can say exactly the same thing. Position is the only thing that is
   * definitely unique, and it is what the ranges in `markdown.ts` are keyed on.
   */
  private locate(taskRef: string, index: number): Task {
    const task = this.store.resolve(taskRef, this.now());
    if (!task) throw new ToolError('not_found', `No single task matches "${taskRef}".`);

    const raw = this.store.rawOf(task.fields.id) ?? '';
    const count = logEntryRanges(raw).length;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new ToolError(
        'not_found',
        `This task has no comment ${index}.`,
        count === 0 ? 'It has no comments.' : `It has ${count}.`,
      );
    }
    return task;
  }

  async edit(taskRef: string, index: number, text: string): Promise<Task> {
    const task = this.locate(taskRef, index);
    const trimmed = text.trim();
    if (!trimmed) {
      throw new ToolError('invalid', 'A comment needs some text.', 'Delete it instead.');
    }

    const existing = this.store.get(task.fields.id)?.log[index];
    if (!existing) throw new ToolError('not_found', `This task has no comment ${index}.`);
    if (trimmed === existing.text) return task;

    const stamp = localIso(this.now());
    return this.store.writeTask(task.fields.id, (current) =>
      setFrontmatterField(
        // Keep the entry's own timestamp and type: an edit fixes the wording, it does not
        // move when the thing happened.
        replaceLogEntry(current, index, { ...existing, text: trimmed }),
        'updated',
        stamp,
      ),
    );
  }

  async remove(taskRef: string, index: number): Promise<Task> {
    const task = this.locate(taskRef, index);
    const stamp = localIso(this.now());
    return this.store.writeTask(task.fields.id, (current) =>
      setFrontmatterField(removeLogEntry(current, index), 'updated', stamp),
    );
  }
}
