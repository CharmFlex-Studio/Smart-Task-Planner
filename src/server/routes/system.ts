import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { PlannerContext } from '../context.js';
import type { Settings } from '../config.js';
import { fail } from './errors.js';

/** Settings, the live event stream, and a health check. */
export function systemRoutes(ctx: PlannerContext): Hono {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      ok: true,
      vault: ctx.paths.vault,
      tasks: ctx.vault.size,
      workspaces: ctx.vault.ids().length,
    }),
  );

  app.get('/settings', (c) => c.json({ settings: ctx.settings, vault: ctx.paths.vault }));

  app.patch('/settings', async (c) => {
    try {
      const body = await c.req.json<Partial<Settings>>();
      const previous = ctx.settings;
      const patch: Partial<Settings> = {};
      if (typeof body.keepLoaded === 'boolean') patch.keepLoaded = body.keepLoaded;
      if (typeof body.autoApplyWrites === 'boolean') patch.autoApplyWrites = body.autoApplyWrites;
      if (typeof body.gitUndo === 'boolean') patch.gitUndo = body.gitUndo;
      if (typeof body.modelFile === 'string') patch.modelFile = body.modelFile;
      if (typeof body.externalModel === 'string') patch.externalModel = body.externalModel;
      if (typeof body.idleTimeoutMs === 'number' && body.idleTimeoutMs >= 10_000) {
        patch.idleTimeoutMs = Math.min(body.idleTimeoutMs, 24 * 60 * 60 * 1000);
      }
      const next = await ctx.updateSettings(patch);
      await ctx.ai.onSettingsChanged(previous, next);
      return c.json({ settings: next });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/reload', async (c) => {
    await ctx.vault.load();
    ctx.bus.emit({ kind: 'reindexed', count: ctx.vault.size });
    ctx.bus.emit({ kind: 'workspaces-changed', workspaces: ctx.vault.summaries() });
    return c.json({ ok: true, tasks: ctx.vault.size });
  });

  /**
   * The live stream. One connection per open tab; the browser's EventSource reconnects on
   * its own, so there is nothing to do here but keep it fed and clean up on close.
   */
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let notify: (() => void) | null = null;

      const unsubscribe = ctx.bus.subscribe((event) => {
        queue.push(JSON.stringify(event));
        notify?.();
      });

      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ tasks: ctx.vault.size }) });

      const heartbeat = setInterval(() => {
        queue.push('');
        notify?.();
      }, 25_000);

      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
        notify?.();
      });

      try {
        while (!stream.closed && !stream.aborted) {
          const item = queue.shift();
          if (item === undefined) {
            await new Promise<void>((resolve) => {
              notify = () => {
                notify = null;
                resolve();
              };
            });
            continue;
          }
          if (item === '') await stream.writeSSE({ event: 'ping', data: '1' });
          else await stream.writeSSE({ event: 'vault', data: item });
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }),
  );

  return app;
}
