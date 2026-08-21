import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { findWebRoot, readStaticFile } from './static.js';
import {
  ensureVault,
  loadSettings,
  migrateLegacyVault,
  resolvePaths,
  type Paths,
  type Settings,
} from './config.js';
import { Vault } from './vault/vault.js';
import { WorkspaceTools } from './tools/workspaces.js';
import { EventBus } from './events.js';
import { GitUndo } from './git.js';
import { AiPlugin } from './ai/plugin.js';
import { makeScope, makeSettingsUpdater, type PlannerContext } from './context.js';
import { taskRoutes } from './routes/tasks.js';
import { boardRoutes } from './routes/board.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { aiRoutes } from './routes/ai.js';
import { systemRoutes } from './routes/system.js';

export interface BuiltApp {
  app: Hono;
  ctx: PlannerContext;
}

/**
 * Assemble the whole server.
 *
 * Everything is wired here and passed down explicitly, so a test can build the same app
 * against a temp directory. The only global state in the process is the AI child process,
 * and that belongs to the plugin.
 */
export async function buildApp(paths: Paths = resolvePaths()): Promise<BuiltApp> {
  const settings: Settings = await loadSettings(paths);

  // A mutable holder so `updateSettings` can swap the object and every consumer that reads
  // through `state.settings` sees the new one without anything being mutated in place.
  const state = { paths, settings };
  const updateSettings = makeSettingsUpdater(state);

  // Read the flag through the holder, so turning history off takes effect immediately
  // rather than at the next restart.
  const git = new GitUndo(paths.vault, () => state.settings.gitUndo);

  // A vault laid out before workspaces existed is moved into the folder layout once, and
  // the move is committed so it is a line in History with an Undo next to it rather than
  // something that silently happened to someone's folder.
  const migrated = await migrateLegacyVault(paths);
  if (migrated) {
    await git.commit(`planner: move "${migrated.name}" into its own workspace folder`);
  }

  await ensureVault(paths);
  const vault = new Vault(paths);
  await vault.load();

  const workspaces = new WorkspaceTools(vault);
  const bus = new EventBus();

  // The plugin is handed a way to scope itself to one workspace, never the vault, so a
  // chat can only ever read the workspace it was asked about.
  const ai = new AiPlugin({
    paths,
    scope: (id) => makeScope(vault, id),
    bus,
    settings: () => state.settings,
  });

  const ctx: PlannerContext = {
    paths,
    vault,
    workspaces,
    bus,
    git,
    ai,
    get settings() {
      return state.settings;
    },
    updateSettings,
    scope: (id) => makeScope(vault, id),
  };

  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    // The page is served from, and only talks to, loopback. Nothing here should ever be
    // embedded elsewhere or fetched cross-origin.
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.route('/api', systemRoutes(ctx));
  app.route('/api', taskRoutes(ctx));
  app.route('/api', boardRoutes(ctx));
  app.route('/api', workspaceRoutes(ctx));
  app.route('/api', aiRoutes(ctx));

  app.notFound((c) =>
    c.req.path.startsWith('/api')
      ? c.json({ error: `No such endpoint: ${c.req.path}`, code: 'not_found' }, 404)
      : c.text('Not found', 404),
  );

  // In production the built frontend is served by this same process, so the whole app is
  // one port and one origin. The files are found relative to this module, never the cwd —
  // an installed planner is launched from wherever the user happens to be standing.
  const webRoot = findWebRoot();
  if (webRoot) {
    app.get('/assets/*', async (c) => {
      const file = await readStaticFile(webRoot, c.req.path);
      if (!file) return c.notFound();
      // Vite fingerprints these filenames, so a changed file is a changed URL.
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
      return c.body(file.body, 200, { 'Content-Type': file.contentType });
    });
    app.get('*', async (c) => {
      const html = await fs.promises.readFile(path.join(webRoot, 'index.html'), 'utf8');
      // Never cached, unlike the assets it names. Vite fingerprints those filenames, so
      // they are safe to keep forever — but that only works if the page naming them is
      // always fresh. A browser holding yesterday's index.html asks for a script that no
      // longer exists, gets a 404, and the app simply does not start: the exact shape of
      // "it worked before I updated".
      c.header('Cache-Control', 'no-cache, must-revalidate');
      return c.html(html);
    });
  }

  return { app, ctx };
}
