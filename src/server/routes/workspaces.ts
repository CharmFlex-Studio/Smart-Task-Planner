import { Hono } from 'hono';
import type { PlannerContext } from '../context.js';
import { fail } from './errors.js';

/**
 * Workspaces: list, create, rename, remove.
 *
 * Deliberately a separate surface from the tasks API, and deliberately absent from the
 * model's tool schema. The assistant works inside a workspace; deciding what the
 * workspaces *are* stays with the person whose folders they are.
 */
export function workspaceRoutes(ctx: PlannerContext): Hono {
  const app = new Hono();

  const announce = () =>
    ctx.bus.emit({ kind: 'workspaces-changed', workspaces: ctx.vault.summaries() });

  app.get('/workspaces', (c) => c.json({ workspaces: ctx.workspaces.list() }));

  app.post('/workspaces', async (c) => {
    try {
      const body = await c.req.json<{ name?: string }>();
      const workspace = await ctx.workspaces.create(String(body.name ?? ''));
      void ctx.git.commit(`planner: add workspace "${workspace.name}"`, [workspace.id]);
      announce();
      return c.json({ workspace }, 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch('/workspaces/:id', async (c) => {
    try {
      const body = await c.req.json<{ name?: string }>();
      const workspace = await ctx.workspaces.rename(c.req.param('id'), String(body.name ?? ''));
      void ctx.git.commit(`planner: rename workspace to "${workspace.name}"`);
      announce();
      return c.json({ workspace });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/workspaces/:id', async (c) => {
    try {
      await ctx.workspaces.remove(c.req.param('id'));
      void ctx.git.commit(`planner: delete workspace "${c.req.param('id')}"`);
      announce();
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}
