import { createHash } from 'node:crypto';
import type { ProposedChange } from '@shared/types.js';
import type { Scope } from '../context.js';
import { executeWrite, summarize } from './chat.js';

/**
 * Pending changes the model has drafted and the user has not answered yet.
 *
 * Applying **re-executes the tool** rather than replaying the stored patch. The file may
 * have moved on since the proposal was drafted -- by another approval, or by the user in
 * their editor -- and a stale patch applied blind is exactly the silent damage this whole
 * design exists to prevent.
 *
 * Staleness is judged on the *file*, not on the patch. An earlier version compared the two
 * unified diffs, which was wrong in a way that only showed up in use: every diff contains
 * the `updated:` timestamp we generate at dry-run time, so two dry runs a second apart
 * never matched and every approval was rejected as a conflict. What we actually want to
 * know is "did the file change since I drafted this", and that is a hash of the file.
 *
 * A proposal remembers which workspace drafted it, so approving it re-runs the tool in that
 * same workspace however long it has been sitting there.
 */

/** Proposals are cheap to redraft, so we keep only a recent window of them. */
const MAX_PENDING = 50;

interface Pending {
  proposal: ProposedChange;
  /** The workspace it was drafted in, and the only one applying it may touch. */
  workspace: string;
  /** Hash of the target file as it was when the proposal was drafted. */
  beforeHash: string;
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export interface ApplyOutcome {
  ok: boolean;
  proposal: ProposedChange;
  /** True when the file changed underneath and the user needs to look again. */
  changed?: boolean;
}

export class ProposalStore {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly scope: (workspace: string) => Scope,
    private readonly onApplied: (workspace: string, path: string) => void = () => {},
  ) {}

  add(proposal: ProposedChange, workspace: string): void {
    this.pending.set(proposal.id, {
      proposal,
      workspace,
      beforeHash: hash(this.scope(workspace).store.rawOfPath(proposal.diff.path) ?? ''),
    });
    while (this.pending.size > MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }

  get(id: string): ProposedChange | undefined {
    return this.pending.get(id)?.proposal;
  }

  get size(): number {
    return this.pending.size;
  }

  discard(id: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.proposal.state = 'discarded';
    this.pending.delete(id);
    return true;
  }

  async apply(id: string): Promise<ApplyOutcome> {
    const entry = this.pending.get(id);
    if (!entry) {
      throw new Error('That change is no longer pending. Ask again and I will redraft it.');
    }

    const { store, tools } = this.scope(entry.workspace);
    const current = hash(store.rawOfPath(entry.proposal.diff.path) ?? '');
    if (current !== entry.beforeHash) {
      // Redraft against what the file says now and hand it back for a second look.
      const dry = await executeWrite(tools, entry.proposal.tool, entry.proposal.args, false);
      const refreshed: ProposedChange = {
        ...entry.proposal,
        diff: dry.diff,
        summary: summarize(entry.proposal.tool, entry.proposal.args, dry),
        state: 'pending',
      };
      this.pending.set(id, { proposal: refreshed, workspace: entry.workspace, beforeHash: current });
      return { ok: false, proposal: refreshed, changed: true };
    }

    const result = await executeWrite(tools, entry.proposal.tool, entry.proposal.args, true);
    const applied: ProposedChange = { ...entry.proposal, diff: result.diff, state: 'applied' };
    this.pending.delete(id);
    this.onApplied(entry.workspace, result.task.path);
    return { ok: true, proposal: applied };
  }
}
