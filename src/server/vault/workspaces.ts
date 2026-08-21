/**
 * Workspaces: a folder of the vault, its tasks, its board.
 *
 * The rule the whole feature rests on is that a workspace *is* a directory. Nothing is
 * tagged, nothing is filtered by a field, and no index has to agree with anything — the
 * files a workspace contains are the files inside its folder. That is what makes the
 * assistant's scope trustworthy: it is handed one folder's store and has no reference to
 * any other, so "the AI can only read this workspace" is not a check that can be forgotten.
 *
 *   vault/
 *   ├── main/             every workspace is a folder, and they are all the same shape
 *   │   ├── board.md      the lanes, and what this workspace is called
 *   │   ├── tasks/
 *   │   └── archive/
 *   └── client-work/
 *       ├── board.md
 *       ├── tasks/
 *       └── archive/
 *
 * There is no special first workspace. An earlier version let the vault root be one, to
 * avoid moving anyone's files, and the result was a vault whose folders did not match each
 * other and a workspace whose id was the empty string — which, among other things, made it
 * the one workspace that could not be renamed. A vault laid out before that changed is
 * migrated once, on startup, by `planLegacyMigration`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { slugify } from './ids.js';
import { ATTACHMENTS_DIR } from './attachments.js';

/** The workspace a fresh vault starts with. */
export const DEFAULT_WORKSPACE_ID = 'main';
export const DEFAULT_WORKSPACE_NAME = 'Main';

/**
 * Folder names a workspace may not use. They are what the pre-workspaces layout put at the
 * top of the vault, and refusing them keeps "is this a workspace called tasks, or the old
 * layout?" from ever being a question anyone has to answer.
 */
export const RESERVED_DIRS = new Set(['tasks', 'archive']);

export interface WorkspacePaths {
  /** Absolute path of the vault root — task paths stay relative to this. */
  vault: string;
  /** Absolute path of the workspace's own folder. */
  dir: string;
  tasks: string;
  archive: string;
  board: string;
  /** Files attached to this workspace's tasks. Inside the folder, like everything else. */
  attachments: string;
}

export function workspacePaths(vault: string, id: string): WorkspacePaths {
  const dir = path.join(vault, id);
  return {
    vault,
    dir,
    tasks: path.join(dir, 'tasks'),
    archive: path.join(dir, 'archive'),
    board: path.join(dir, 'board.md'),
    attachments: path.join(dir, ATTACHMENTS_DIR),
  };
}

/** Vault-relative path of a workspace's board file. */
export function boardPath(id: string): string {
  return `${id}/board.md`;
}

/** The workspace a vault-relative path belongs to, or null when it is not a task file. */
export function workspaceOfPath(rel: string): { workspace: string; archived: boolean } | null {
  const parts = rel.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0]!.startsWith('.')) return null;
  if (parts[1] === 'tasks') return { workspace: parts[0]!, archived: false };
  if (parts[1] === 'archive') return { workspace: parts[0]!, archived: true };
  return null;
}

/** The workspace whose board file this is, or null when the path is not a board. */
export function workspaceOfBoardPath(rel: string): string | null {
  const parts = rel.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[1] !== 'board.md' || parts[0]!.startsWith('.')) return null;
  return parts[0]!;
}

/** A folder name for a workspace. Empty when the name has nothing to make one from. */
export function workspaceId(name: string): string {
  return slugify(name, '');
}

/** `product-design` -> `Product design`, for a folder nobody named in `board.md`. */
export function humanizeWorkspaceId(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

async function isWorkspaceFolder(dir: string): Promise<boolean> {
  // A board or a tasks folder is what makes a directory a workspace, so an unrelated
  // folder someone keeps in their vault (attachments, say) is not mistaken for one.
  const [board, tasks] = await Promise.all([
    exists(path.join(dir, 'board.md')),
    exists(path.join(dir, 'tasks')),
  ]);
  return board || tasks;
}

/**
 * Every workspace in the vault, alphabetically. Always returns at least one, so the app can
 * never find itself with nowhere to put a task; the folder is created on first write.
 */
export async function discoverWorkspaceIds(vault: string): Promise<string[]> {
  const ids: string[] = [];
  let items: import('node:fs').Dirent[];
  try {
    items = await fs.readdir(vault, { withFileTypes: true });
  } catch {
    return [DEFAULT_WORKSPACE_ID];
  }

  for (const item of items) {
    if (!item.isDirectory()) continue;
    if (item.name.startsWith('.') || RESERVED_DIRS.has(item.name)) continue;
    if (await isWorkspaceFolder(path.join(vault, item.name))) ids.push(item.name);
  }
  ids.sort((a, b) => a.localeCompare(b));
  return ids.length > 0 ? ids : [DEFAULT_WORKSPACE_ID];
}

/* ------------------------------------------------------- the old layout */

export interface LegacyMigration {
  /** Vault-relative names to move, in order. */
  moves: { from: string; to: string }[];
  /** The folder everything is moving into. */
  workspace: string;
  name: string;
}

/**
 * Work out how to turn a pre-workspaces vault — `tasks/`, `archive/` and `board.md` sitting
 * at the top — into a workspace folder like every other. Returns null when there is nothing
 * to do, which is every start after the first.
 *
 * The new folder is named after whatever the old board called itself, so someone who had
 * renamed their workspace keeps that name and gets a folder that matches it.
 */
export async function planLegacyMigration(vault: string): Promise<LegacyMigration | null> {
  const legacy = ['tasks', 'archive', 'board.md'].filter(Boolean);
  const present: string[] = [];
  for (const entry of legacy) {
    if (await exists(path.join(vault, entry))) present.push(entry);
  }
  if (!present.includes('tasks') && !present.includes('board.md')) return null;

  const name = (await readBoardName(path.join(vault, 'board.md'))) ?? DEFAULT_WORKSPACE_NAME;
  const wanted = workspaceId(name) || DEFAULT_WORKSPACE_ID;

  // Never move anything on top of a folder that is already there.
  let workspace = wanted;
  for (let n = 2; await exists(path.join(vault, workspace)); n++) workspace = `${wanted}-${n}`;

  return {
    workspace,
    name,
    moves: present.map((entry) => ({ from: entry, to: `${workspace}/${entry}` })),
  };
}

/** The `name:` in a board file, read without caring about anything else in it. */
async function readBoardName(file: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)/)?.[1] ?? '';
    const name = front.match(/^name:[ \t]*(.+)$/m)?.[1]?.trim();
    return name ? name.replace(/^["']|["']$/g, '').trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** Carry out a plan from `planLegacyMigration`. Moves only; nothing is deleted or rewritten. */
export async function applyLegacyMigration(
  vault: string,
  plan: LegacyMigration,
): Promise<void> {
  await fs.mkdir(path.join(vault, plan.workspace), { recursive: true });
  for (const move of plan.moves) {
    await fs.rename(path.join(vault, move.from), path.join(vault, ...move.to.split('/')));
  }
}
