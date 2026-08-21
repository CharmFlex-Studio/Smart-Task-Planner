import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VaultStore } from '../vault/store.js';
import { workspacePaths } from '../vault/workspaces.js';
import { PlannerTools } from '../tools/index.js';
import { LaneTools } from '../tools/lanes.js';
import { ProposalStore } from './proposals.js';
import { executeWrite, summarize } from './chat.js';
import type { ProposedChange } from '@shared/types.js';
import type { Scope } from '../context.js';

let dir: string;
let store: VaultStore;
let tools: PlannerTools;
let proposals: ProposalStore;
let now: Date;


/** Draft a proposal the way the chat loop does: a dry run, packaged for approval. */
async function draft(tool: string, args: Record<string, unknown>): Promise<ProposedChange> {
  const dry = await executeWrite(tools, tool, args, false);
  const proposal: ProposedChange = {
    id: `p-${Math.random()}`,
    tool,
    args,
    diff: dry.diff,
    summary: summarize(tool, args, dry),
    state: 'pending',
  };
  proposals.add(proposal, '');
  return proposal;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-'));
  const paths = workspacePaths(dir, 'main');
  await fs.mkdir(paths.tasks, { recursive: true });
  await fs.mkdir(paths.archive, { recursive: true });
  await fs.writeFile(
    path.join(paths.tasks, 'pay.md'),
    '---\nid: pay1\ntitle: Payment integration\nstatus: active\nupdated: 2026-08-18T09:00:00\n---\n\n## Log\n\n- 2026-08-18 09:00 · progress · started\n',
    'utf8',
  );
  store = new VaultStore(paths, 'main');
  await store.load();
  now = new Date('2026-08-20T12:00:00');
  tools = new PlannerTools(store, () => now);
  // One workspace here; the scope factory is what the plugin passes in real life.
  const scope: Scope = {
    id: '',
    name: 'Main',
    store,
    tools,
    lanes: new LaneTools(store, tools),
  };
  proposals = new ProposalStore(() => scope);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const read = () => fs.readFile(path.join(dir, 'main/tasks/pay.md'), 'utf8');

describe('a pending proposal touches nothing', () => {
  it('leaves the file alone until it is applied', async () => {
    const before = await read();
    await draft('add_log', { task: 'pay1', text: 'drafted only' });
    expect(await read()).toBe(before);
  });
});

describe('applying', () => {
  it('writes the change', async () => {
    const proposal = await draft('add_log', { task: 'pay1', text: 'approved' });
    const result = await proposals.apply(proposal.id);
    expect(result.ok).toBe(true);
    expect(result.proposal.state).toBe('applied');
    expect(await read()).toContain('· note · approved');
  });

  it('still applies when time has passed since drafting', async () => {
    // Regression: staleness used to be judged by comparing the two unified diffs. Every
    // diff carries the `updated:` timestamp we generate at dry-run time, so a proposal
    // approved even one second later never matched and was rejected as a conflict.
    const proposal = await draft('add_log', { task: 'pay1', text: 'later' });
    now = new Date('2026-08-20T12:47:31');
    const result = await proposals.apply(proposal.id);
    expect(result.ok).toBe(true);
    expect(await read()).toContain('· note · later');
  });

  it('cannot be applied twice', async () => {
    const proposal = await draft('add_log', { task: 'pay1', text: 'once' });
    await proposals.apply(proposal.id);
    await expect(proposals.apply(proposal.id)).rejects.toThrow(/no longer pending/i);
    expect((await read()).match(/· once/g)).toHaveLength(1);
  });

  it('refuses and redrafts when the file changed underneath', async () => {
    const proposal = await draft('add_log', { task: 'pay1', text: 'mine' });

    // Someone edits the file in their editor after the model drafted the change.
    await fs.writeFile(
      path.join(dir, 'main/tasks/pay.md'),
      '---\nid: pay1\ntitle: Payment integration\nstatus: active\n---\n\n## Log\n\n- 2026-08-19 10:00 · note · typed by hand\n',
      'utf8',
    );
    await store.load();

    const result = await proposals.apply(proposal.id);
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.proposal.state).toBe('pending');
    expect(result.proposal.diff.patch).toContain('typed by hand');
    expect(await read()).not.toContain('mine');

    // Approving the redrafted version goes through.
    const second = await proposals.apply(proposal.id);
    expect(second.ok).toBe(true);
    const final = await read();
    expect(final).toContain('typed by hand');
    expect(final).toContain('· note · mine');
  });
});

describe('discarding', () => {
  it('drops the proposal and never writes', async () => {
    const before = await read();
    const proposal = await draft('add_log', { task: 'pay1', text: 'no thanks' });
    expect(proposals.discard(proposal.id)).toBe(true);
    expect(proposals.get(proposal.id)).toBeUndefined();
    await expect(proposals.apply(proposal.id)).rejects.toThrow();
    expect(await read()).toBe(before);
  });

  it('reports an unknown id rather than pretending', () => {
    expect(proposals.discard('nope')).toBe(false);
  });
});

describe('create proposals', () => {
  it('previews a file that does not exist and creates it on approval', async () => {
    const proposal = await draft('create_task', { title: 'Brand new', description: 'Begin here' });
    expect(proposal.diff.created).toBe(true);
    await expect(fs.access(path.join(dir, 'main/tasks/brand-new.md'))).rejects.toThrow();

    const result = await proposals.apply(proposal.id);
    expect(result.ok).toBe(true);
    const raw = await fs.readFile(path.join(dir, 'main/tasks/brand-new.md'), 'utf8');
    expect(raw).toContain('title: Brand new');
    expect(raw).toContain('Begin here');
  });
});
