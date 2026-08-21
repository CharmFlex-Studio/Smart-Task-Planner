/**
 * Where things live, and the handful of settings the user can change.
 *
 * The vault is the user's folder of markdown and is the only thing that matters; every
 * other path under `~/.watsmytask` is a cache we could delete and rebuild (runtime
 * binaries, models, logs). Keeping that split sharp is what lets us promise "your data is
 * a folder".
 */

import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { DEFAULT_LANES, serializeBoardFile } from './vault/board.js';
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  applyLegacyMigration,
  discoverWorkspaceIds,
  planLegacyMigration,
  workspacePaths,
  type LegacyMigration,
} from './vault/workspaces.js';

export interface Settings {
  /** Keep llama-server resident instead of stopping it when idle. Costs RAM, saves latency. */
  keepLoaded: boolean;
  /** Milliseconds of inactivity before the model is unloaded. */
  idleTimeoutMs: number;
  /** Apply the chatbot's write tools without asking. Off by default, and it should stay off. */
  autoApplyWrites: boolean;
  /** Filename of the downloaded .gguf to run, when managing our own llama-server. */
  modelFile?: string;
  /** Model name to ask an external server for, when one is configured. */
  externalModel?: string;
  /** Commit every applied change to the vault's git repo, when it is one. */
  gitUndo: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  keepLoaded: false,
  idleTimeoutMs: 5 * 60 * 1000,
  autoApplyWrites: false,
  gitUndo: true,
};

export interface Paths {
  vault: string;
  meta: string;
  settingsFile: string;
  appData: string;
  runtime: string;
  models: string;
  logs: string;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * A folder whose name changed when the app was renamed to watsmytask.
 *
 * The new name is what a fresh install gets, but a folder somebody already has keeps
 * working exactly where it is: the old name wins the moment it is actually on disk.
 * Nothing is moved and nothing is copied. Renaming a product must never orphan a vault
 * full of someone's work, or strand the gigabytes of model they already downloaded — and
 * a rename that quietly starts them over with an empty board looks exactly like data loss
 * from the outside, whatever the folder listing says.
 */
function preferExisting(parent: string, name: string, legacyName: string): string {
  const wanted = path.join(parent, name);
  if (fsSync.existsSync(wanted)) return wanted;
  const legacy = path.join(parent, legacyName);
  return fsSync.existsSync(legacy) ? legacy : wanted;
}

/**
 * Read a setting from the environment.
 *
 * `WATSMYTASK_*` is the name; `PLANNER_*` is what the app used to be configured with and
 * is still honoured, so an existing shell profile or launch script does not break on the
 * day of the rename.
 */
function envVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[`WATSMYTASK_${name}`] ?? env[`PLANNER_${name}`];
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = os.homedir();
  const vault = path.resolve(
    expandHome(envVar(env, 'VAULT') ?? preferExisting(home, 'watsmytask-vault', 'planner-vault')),
  );
  const appData = path.resolve(
    expandHome(envVar(env, 'HOME') ?? preferExisting(home, '.watsmytask', '.planner')),
  );
  // The metadata folder lives inside the vault, so it follows the same rule: a vault that
  // already carries a `.planner` keeps it, and its settings keep being read.
  const meta = preferExisting(vault, '.watsmytask', '.planner');
  return {
    vault,
    meta,
    settingsFile: path.join(meta, 'config.json'),
    appData,
    runtime: path.join(appData, 'runtime'),
    models: path.join(appData, 'models'),
    logs: path.join(appData, 'logs'),
  };
}

export function serverPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(envVar(env, 'PORT') ?? 5123);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 5123;
}

/** Everything is loopback-only. Changing this is an explicit, visible decision. */
export const BIND_HOST = '127.0.0.1';

/**
 * Point the AI at an OpenAI-compatible server that is already running, instead of
 * downloading and managing our own llama-server.
 *
 * Set `WATSMYTASK_AI_BASE_URL=http://127.0.0.1:11434/v1` to use an existing Ollama install
 * (note the `/v1`), which is how this is developed against. It also means someone who
 * already has a local model does not have to download a second copy of one.
 *
 * Only loopback addresses are honoured. The promise this app makes is that task data
 * never leaves the machine, and an env var is not a good enough reason to break it.
 */
export function externalAiBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = envVar(env, 'AI_BASE_URL')?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.warn(`[watsmytask] ignoring malformed WATSMYTASK_AI_BASE_URL: ${raw}`);
    return null;
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    console.warn(
      `[watsmytask] refusing WATSMYTASK_AI_BASE_URL "${raw}": only loopback addresses are allowed, ` +
        'because task data must not leave this machine.',
    );
    return null;
  }
  return raw.replace(/\/$/, '');
}

/**
 * Which model to ask an external server for. llama-server serves whatever it was started
 * with and ignores this, but Ollama needs the real name (e.g. `qwen2.5:3b`).
 */
export function externalAiModel(
  settings?: { externalModel?: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  return settings?.externalModel?.trim() || envVar(env, 'AI_MODEL')?.trim() || 'local';
}

const VAULT_GITIGNORE = `# Rebuilt on demand — safe to delete, never worth committing.
index.json
logs/
`;

/**
 * Move a vault that predates workspaces into the layout every workspace uses: `tasks/`,
 * `archive/` and `board.md` from the top of the vault into a folder of their own. Files are
 * moved, never rewritten, and never on top of anything that already exists.
 *
 * Returns what it did, so the caller can record it as a commit the user can undo.
 */
export async function migrateLegacyVault(paths: Paths): Promise<LegacyMigration | null> {
  const plan = await planLegacyMigration(paths.vault);
  if (!plan) return null;
  await applyLegacyMigration(paths.vault, plan);
  console.log(
    `[watsmytask] moved tasks/, archive/ and board.md into "${plan.workspace}/" — ` +
      'every workspace is a folder now.',
  );
  return plan;
}

/**
 * Make sure the vault has somewhere to put a task: a metadata folder, and one workspace.
 * A vault that already has workspace folders is left exactly as it is.
 */
export async function ensureVault(paths: Paths): Promise<void> {
  await fs.mkdir(paths.meta, { recursive: true });
  const gitignore = path.join(paths.meta, '.gitignore');
  await fs.writeFile(gitignore, VAULT_GITIGNORE).catch(() => {});

  // Discovery names a default workspace even for an empty vault, so ask whether any of the
  // folders it named is actually there before creating one.
  const found = await discoverWorkspaceIds(paths.vault);
  const onDisk = await Promise.all(
    found.map((id) =>
      fs
        .access(path.join(paths.vault, id))
        .then(() => true)
        .catch(() => false),
    ),
  );
  if (onDisk.some(Boolean)) return;

  const first = workspacePaths(paths.vault, DEFAULT_WORKSPACE_ID);
  await fs.mkdir(first.tasks, { recursive: true });
  await fs.mkdir(first.archive, { recursive: true });
  // The board is a vault file like everything else. Written once, with the starting lanes,
  // so it is there to be edited rather than conjured on first rename.
  await fs
    .writeFile(first.board, serializeBoardFile([...DEFAULT_LANES], DEFAULT_WORKSPACE_NAME), {
      flag: 'wx',
    })
    .catch(() => {});
}

export async function loadSettings(paths: Paths): Promise<Settings> {
  try {
    const raw = await fs.readFile(paths.settingsFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(paths: Paths, settings: Settings): Promise<void> {
  await fs.mkdir(paths.meta, { recursive: true });
  await fs.writeFile(paths.settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}
