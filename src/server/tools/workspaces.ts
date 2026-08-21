/**
 * Workspace operations: create, rename, remove.
 *
 * Like the lane operations, these are UI-only and never reach the model's tool schema. The
 * assistant is given one workspace and cannot see that the others exist, let alone add or
 * delete one — which is the whole point of the feature.
 */

import type { WorkspaceSummary } from '@shared/types.js';
import type { Vault } from '../vault/vault.js';
import { RESERVED_DIRS, workspaceId } from '../vault/workspaces.js';
import { ToolError } from './errors.js';

const MAX_NAME = 40;

export class WorkspaceTools {
  constructor(private readonly vault: Vault) {}

  list(): WorkspaceSummary[] {
    return this.vault.summaries();
  }

  async create(name: string): Promise<WorkspaceSummary> {
    const clean = this.mustName(name);
    const id = workspaceId(clean);
    if (!id) {
      throw new ToolError('invalid', `"${clean}" does not make a usable folder name.`);
    }
    if (RESERVED_DIRS.has(id)) {
      throw new ToolError(
        'invalid',
        `A workspace cannot be called "${clean}".`,
        'That folder name belongs to the layout this vault used before workspaces existed.',
      );
    }
    if (this.vault.has(id)) {
      throw new ToolError('invalid', `There is already a workspace in the folder "${id}".`);
    }
    return this.vault.createWorkspace(id, clean);
  }

  async rename(id: string, name: string): Promise<WorkspaceSummary> {
    return this.vault.renameWorkspace(this.mustExist(id), this.mustName(name));
  }

  /** Only ever removes an empty workspace — see `Vault.removeWorkspace`. */
  async remove(id: string): Promise<void> {
    const target = this.mustExist(id);
    try {
      await this.vault.removeWorkspace(target);
    } catch (err) {
      throw new ToolError(
        'invalid',
        (err as Error).message,
        'Move or delete its tasks first — deleting a folder of notes should take more than one click.',
      );
    }
  }

  private mustExist(id: string): string {
    if (!this.vault.has(id)) {
      throw new ToolError('not_found', `There is no workspace called "${id}".`);
    }
    return id;
  }

  private mustName(name: string): string {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) throw new ToolError('invalid', 'A workspace needs a name.');
    if (clean.length > MAX_NAME) {
      throw new ToolError('invalid', `A workspace name has to be ${MAX_NAME} characters or fewer.`);
    }
    return clean;
  }
}
