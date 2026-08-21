import type { Paths, Settings } from './config.js';
import { saveSettings } from './config.js';
import type { Vault } from './vault/vault.js';
import type { VaultStore } from './vault/store.js';
import { PlannerTools } from './tools/index.js';
import { LaneTools } from './tools/lanes.js';
import { CommentTools } from './tools/comments.js';
import type { WorkspaceTools } from './tools/workspaces.js';
import type { EventBus } from './events.js';
import type { GitUndo } from './git.js';
import type { AiPlugin } from './ai/plugin.js';

/**
 * Everything the routes need, assembled once at startup and passed down explicitly.
 *
 * No module-level singletons: the whole app can be constructed against a temp directory
 * in a test, which is what makes the HTTP layer testable without a running server.
 */

/**
 * One workspace, and the only things allowed to touch its files. A request gets a
 * scope and nothing wider, so a handler cannot reach another workspace's tasks even by
 * accident — which is what the assistant's promise rests on.
 */
export interface Scope {
  id: string;
  name: string;
  store: VaultStore;
  tools: PlannerTools;
  lanes: LaneTools;
  /** Editing and removing comments. UI-only, like lanes — see `tools/comments.ts`. */
  comments: CommentTools;
}

export interface PlannerContext {
  paths: Paths;
  vault: Vault;
  workspaces: WorkspaceTools;
  bus: EventBus;
  git: GitUndo;
  ai: AiPlugin;
  settings: Settings;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Throws `UnknownWorkspaceError` for an id the vault does not have. */
  scope(id?: string | null): Scope;
}

/** Build the scope for one workspace. Cheap enough to do per request. */
export function makeScope(vault: Vault, id?: string | null): Scope {
  const store = vault.store(id);
  const tools = new PlannerTools(store);
  return {
    id: store.id,
    name: store.name,
    store,
    tools,
    lanes: new LaneTools(store, tools),
    comments: new CommentTools(store),
  };
}

export function makeSettingsUpdater(ctx: { paths: Paths; settings: Settings }) {
  return async (patch: Partial<Settings>): Promise<Settings> => {
    // Replace rather than mutate, so anything holding the old object keeps a stable view.
    const next: Settings = { ...ctx.settings, ...patch };
    await saveSettings(ctx.paths, next);
    ctx.settings = next;
    return next;
  };
}
