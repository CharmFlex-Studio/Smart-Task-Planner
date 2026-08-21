import { Hono } from 'hono';
import type { PlannerContext } from '../context.js';
import { boardPath } from '../vault/workspaces.js';
import type { LaneChange } from '../tools/lanes.js';
import { fail } from './errors.js';

/**
 * The board's own columns.
 *
 * Thin wrappers over `LaneTools`, exactly like the task routes are thin wrappers over the
 * task tools. Nothing here is reachable by the model: lanes are the user's structure and
 * the assistant only ever moves a task between them.
 *
 * Each workspace has its own board, so every route here takes `?ws=` like the task routes.
 */
export function boardRoutes(ctx: PlannerContext): Hono {
  const app = new Hono();

  const scope = (c: { req: { query(k: string): string | undefined } }) => ctx.scope(c.req.query('ws'));

  /** Announce the new columns and commit `board.md`, the same way a task write does. */
  const record = (change: LaneChange, workspace: string, verb: string) => {
    void ctx.git.commit(`planner: ${verb}`, [boardPath(workspace)]);
    ctx.bus.emit({ kind: 'board-changed', board: change.board });
    return change;
  };

  app.get('/board', (c) => {
    try {
      return c.json({ board: scope(c).store.boardView() });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/board/lanes', async (c) => {
    try {
      const { id, lanes } = scope(c);
      const body = await c.req.json<{ name?: string; at?: number }>();
      const change = await lanes.create(String(body.name ?? ''), body.at);
      return c.json(record(change, id, `add lane "${String(body.name ?? '').trim()}"`), 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch('/board/lanes/:id', async (c) => {
    try {
      const { id, lanes } = scope(c);
      const body = await c.req.json<{ name?: string; done?: boolean }>();
      const patch: { name?: string; done?: boolean } = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (typeof body.done === 'boolean') patch.done = body.done;
      const change = await lanes.update(c.req.param('id'), patch);
      return c.json(record(change, id, `edit lane "${c.req.param('id')}"`));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/board/lanes/:id', async (c) => {
    try {
      const change = await scope(c).lanes.remove(c.req.param('id'), c.req.query('moveTo'));
      // Lane deletion rewrites task files too, so the whole vault goes into the commit.
      void ctx.git.commit(`planner: delete lane "${c.req.param('id')}"`);
      ctx.bus.emit({ kind: 'board-changed', board: change.board });
      ctx.bus.emit({ kind: 'reindexed', count: ctx.vault.size });
      return c.json(change);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/board/lanes/order', async (c) => {
    try {
      const scoped = scope(c);
      const body = await c.req.json<{ ids?: unknown }>();
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : [];
      const change = await scoped.lanes.reorder(ids);
      return c.json(record(change, scoped.id, 'reorder lanes'));
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}
