import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { BIND_HOST, resolvePaths, serverPort } from './config.js';
import { watchVault } from './watcher.js';

export interface RunningPlanner {
  port: number;
  vault: string;
  tasks: number;
  workspaces: number;
  close: () => Promise<void>;
}

/**
 * Start the server and return once it is listening.
 *
 * Binds to 127.0.0.1 only. That is the single most important line in this file: the
 * planner holds someone's private working notes and there is no authentication, because
 * there does not need to be as long as nothing outside this machine can reach it.
 */
export async function startPlanner(env: NodeJS.ProcessEnv = process.env): Promise<RunningPlanner> {
  const paths = resolvePaths(env);
  const port = serverPort(env);
  const { app, ctx } = await buildApp(paths);

  const watcher = watchVault(paths, ctx.vault, ctx.bus);

  const { server, boundPort } = await new Promise<{
    server: ReturnType<typeof serve>;
    boundPort: number;
  }>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, hostname: BIND_HOST, port }, (info) => {
      // The startup listener only exists to turn a failed bind — EADDRINUSE, almost
      // always — into a rejection the caller can explain. Take it off once we are
      // listening, or every later server error would be swallowed by a settled promise.
      s.off('error', reject);
      s.on('error', (err) => console.error('[watsmytask] server error:', err));
      resolve({ server: s, boundPort: info.port });
    });
    s.on('error', reject);
  }).catch(async (err: unknown) => {
    // Do not leave a file watcher or a loaded model behind a failed start.
    await watcher.close().catch(() => {});
    await ctx.ai.stop().catch(() => {});
    throw err;
  });

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await watcher.close().catch(() => {});
      await ctx.ai.stop().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })();
    return closing;
  };

  return {
    port: boundPort,
    vault: paths.vault,
    tasks: ctx.vault.size,
    workspaces: ctx.vault.ids().length,
    close,
  };
}

/** Wire SIGINT/SIGTERM to an orderly shutdown, so the model never outlives the server. */
export function installShutdownHandlers(planner: RunningPlanner): void {
  const shutdown = async (signal: string) => {
    console.log(`\n[watsmytask] ${signal} received, shutting down.`);
    // Do not let a hung connection keep the model resident.
    const forced = setTimeout(() => process.exit(0), 3000);
    forced.unref();
    await planner.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
