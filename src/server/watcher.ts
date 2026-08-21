import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Paths } from './config.js';
import type { Vault } from './vault/vault.js';
import type { EventBus } from './events.js';
import { workspaceOfBoardPath, workspaceOfPath } from './vault/workspaces.js';

/**
 * Watch the vault for edits made outside the app.
 *
 * The whole vault is watched rather than a fixed pair of folders, because a workspace is a
 * folder someone can create in Finder. A new one appearing is picked up the same way a new
 * task file is: reparse, tell the browser, move on.
 *
 * Debounced, because a save from an editor is often several filesystem events, and because
 * our own atomic writes land as a create + rename that we would otherwise re-broadcast to
 * ourselves.
 */
export function watchVault(
  paths: Paths,
  vault: Vault,
  bus: EventBus,
  debounceMs = 120,
): FSWatcher {
  const pending = new Map<string, NodeJS.Timeout>();

  const relative = (abs: string) => path.relative(paths.vault, abs).split(path.sep).join('/');

  const announceWorkspaces = () =>
    bus.emit({ kind: 'workspaces-changed', workspaces: vault.summaries() });

  const schedule = (key: string, run: () => Promise<void>) => {
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        void run();
      }, debounceMs),
    );
  };

  const onFile = (abs: string, removed: boolean) => {
    const rel = relative(abs);
    if (!rel.endsWith('.md') || rel.split('/').some((part) => part.startsWith('.'))) return;
    if (workspaceOfPath(rel) === null && workspaceOfBoardPath(rel) === null) return;

    schedule(rel, async () => {
      if (removed) {
        vault.forgetPath(rel);
        bus.emit({ kind: 'task-removed', path: rel });
        announceWorkspaces();
        return;
      }
      const change = await vault.syncPath(rel);
      if (change.kind === 'board') {
        bus.emit({ kind: 'board-changed', board: vault.store(change.workspace).boardView() });
        announceWorkspaces();
      } else if (change.kind === 'task') {
        if (change.task) bus.emit({ kind: 'task-changed', path: rel, task: change.task });
        else bus.emit({ kind: 'task-removed', path: rel });
        announceWorkspaces();
      }
    });
  };

  /** A folder appearing or vanishing at the top of the vault can mean a whole workspace. */
  const onDir = (abs: string) => {
    const rel = relative(abs);
    if (!rel || rel.includes('/') || rel.startsWith('.')) return;
    schedule('~workspaces', async () => {
      await vault.load();
      bus.emit({ kind: 'reindexed', count: vault.size });
      announceWorkspaces();
    });
  };

  return chokidar
    .watch(paths.vault, {
      ignoreInitial: true,
      ignored: (p) => path.basename(p).startsWith('.') || p.endsWith('.tmp'),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    })
    .on('add', (p) => onFile(p, false))
    .on('change', (p) => onFile(p, false))
    .on('unlink', (p) => onFile(p, true))
    .on('addDir', (p) => onDir(p))
    .on('unlinkDir', (p) => onDir(p));
}
