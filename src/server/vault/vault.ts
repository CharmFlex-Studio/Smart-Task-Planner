/**
 * The vault: the workspaces in it, and which one a request is talking about.
 *
 * This is the only object that can see more than one workspace. Everything downstream —
 * the task tools, the lane tools, the chat — is handed a single `VaultStore` and can
 * therefore only reach that workspace's files. Keeping the multi-workspace view in one
 * small class is what makes that easy to check by reading rather than by testing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Paths } from '../config.js';
import { VaultStore, NotFoundError } from './store.js';
import {
  DEFAULT_WORKSPACE_ID,
  discoverWorkspaceIds,
  workspaceOfBoardPath,
  workspaceOfPath,
  workspacePaths,
} from './workspaces.js';
import { DEFAULT_LANES, serializeBoardFile } from './board.js';
import type { Task, WorkspaceSummary } from '@shared/types.js';

export class UnknownWorkspaceError extends Error {
  constructor(readonly id: string) {
    super(`There is no workspace called "${id}".`);
    this.name = 'UnknownWorkspaceError';
  }
}

export class Vault {
  private stores = new Map<string, VaultStore>();
  /** Display order: alphabetical, which is also the order the folders appear on disk. */
  private order: string[] = [];

  constructor(private readonly paths: Paths) {}

  /* ------------------------------------------------------------- loading */

  async load(): Promise<void> {
    const ids = await discoverWorkspaceIds(this.paths.vault);
    const stores = new Map<string, VaultStore>();
    for (const id of ids) {
      // Reuse a store we already have so a reload does not throw away its index for no
      // reason; a fresh one for anything that appeared since.
      const store = this.stores.get(id) ?? new VaultStore(workspacePaths(this.paths.vault, id), id);
      await store.load();
      stores.set(id, store);
    }
    this.stores = stores;
    this.order = ids;
  }

  /* -------------------------------------------------------------- lookup */

  ids(): string[] {
    return [...this.order];
  }

  has(id: string): boolean {
    return this.stores.has(id);
  }

  /**
   * Which workspace a request means. Nothing, or an empty string, means the first one. An
   * id we do not have is an error rather than a silent fallback: quietly showing someone
   * another workspace's tasks would be a worse answer than saying so.
   */
  resolveId(id: string | undefined | null): string {
    if (id === undefined || id === null || id === '') return this.order[0] ?? DEFAULT_WORKSPACE_ID;
    if (!this.stores.has(id)) throw new UnknownWorkspaceError(id);
    return id;
  }

  /** The store for one workspace. The only way anything downstream gets file access. */
  store(id: string | undefined | null): VaultStore {
    const resolved = this.resolveId(id);
    const store = this.stores.get(resolved);
    if (!store) throw new UnknownWorkspaceError(resolved);
    return store;
  }

  summaries(): WorkspaceSummary[] {
    return this.order.flatMap((id) => {
      const store = this.stores.get(id);
      return store ? [{ id, name: store.name, taskCount: store.openCount }] : [];
    });
  }

  get size(): number {
    let total = 0;
    for (const store of this.stores.values()) total += store.size;
    return total;
  }

  /* ------------------------------------------------------------- writing */

  /**
   * Create a workspace: a folder, its two subfolders and a board. The folder name is the
   * identity, so it is derived once from the name and never changes again.
   */
  async createWorkspace(id: string, name: string): Promise<WorkspaceSummary> {
    const paths = workspacePaths(this.paths.vault, id);
    await fs.mkdir(paths.tasks, { recursive: true });
    await fs.mkdir(paths.archive, { recursive: true });
    await fs.writeFile(paths.board, serializeBoardFile([...DEFAULT_LANES], name), {
      encoding: 'utf8',
      flag: 'wx',
    });
    await this.load();
    const store = this.stores.get(id);
    return { id, name: store?.name ?? name, taskCount: 0 };
  }

  /** Rename by rewriting one line of the workspace's `board.md`. Nothing moves on disk. */
  async renameWorkspace(id: string, name: string): Promise<WorkspaceSummary> {
    const store = this.store(id);
    await store.saveName(name);
    return { id: store.id, name: store.name, taskCount: store.openCount };
  }

  /**
   * Remove an empty workspace's folder. Refusing to delete one that still holds tasks is
   * deliberate: a folder of someone's notes is not something an app should be able to
   * remove in one click, and moving them out first is a decision only they can make.
   */
  async removeWorkspace(id: string): Promise<void> {
    const store = this.store(id);
    if (this.order.length <= 1) {
      throw new Error('The vault needs at least one workspace.');
    }
    if (!store.isEmpty) {
      throw new Error(`"${store.name}" still has tasks in it.`);
    }
    await fs.rm(path.join(this.paths.vault, store.id), { recursive: true, force: true });
    this.stores.delete(store.id);
    this.order = this.order.filter((existing) => existing !== store.id);
  }

  /* ------------------------------------------------------------- watching */

  /**
   * Re-read one file the watcher saw change. Returns what it was, so the caller can say
   * what happened without having to work out which folder the path belongs to.
   */
  async syncPath(rel: string): Promise<
    | { kind: 'task'; workspace: string; task: Task | undefined }
    | { kind: 'board'; workspace: string }
    | { kind: 'ignored' }
  > {
    const board = workspaceOfBoardPath(rel);
    if (board !== null) {
      if (!this.stores.has(board)) await this.load();
      const store = this.stores.get(board);
      if (!store) return { kind: 'ignored' };
      await store.loadBoard();
      return { kind: 'board', workspace: board };
    }

    const located = workspaceOfPath(rel);
    if (!located) return { kind: 'ignored' };
    // A file in a folder we have never seen means a workspace was created outside the app.
    if (!this.stores.has(located.workspace)) await this.load();
    const store = this.stores.get(located.workspace);
    if (!store) return { kind: 'ignored' };
    return { kind: 'task', workspace: located.workspace, task: await store.syncPath(rel) };
  }

  forgetPath(rel: string): void {
    const located = workspaceOfPath(rel);
    if (located) this.stores.get(located.workspace)?.forgetPath(rel);
  }
}

export { NotFoundError };
