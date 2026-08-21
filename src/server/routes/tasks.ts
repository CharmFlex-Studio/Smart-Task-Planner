import { Hono } from 'hono';
import type { PlannerContext } from '../context.js';
import { buildToday } from '../today.js';
import { fail } from './errors.js';
import type { SetFieldName, Task, WriteResult } from '@shared/types.js';

/**
 * The task API. Every write route is a thin wrapper over one tool operation -- the routes
 * hold no logic of their own, so the HTTP surface and the chatbot cannot drift apart.
 *
 * Every route works inside one workspace, named by `?ws=`. Omitting it means the default
 * workspace rather than "all of them": there is no route in this app that can read across
 * workspaces, because there is no object below this line that can.
 *
 * `?dryRun=1` on any write returns the diff without touching the disk. The UI uses it for
 * destructive-looking actions; the chat uses it for everything.
 */
export function taskRoutes(ctx: PlannerContext): Hono {
  const app = new Hono();

  const dry = (c: { req: { query(k: string): string | undefined } }) =>
    c.req.query('dryRun') === '1' || c.req.query('dryRun') === 'true';

  const scope = (c: { req: { query(k: string): string | undefined } }) => ctx.scope(c.req.query('ws'));

  /** Commit an applied write to the vault's git repo, if it is one. Never blocks the response. */
  /**
   * A write that was applied directly rather than proposed — comment edits, which have no
   * diff to approve because no model asked for them. Same commit and same live update, so
   * History and the open tab do not care which path a change came down.
   */
  const recordDirect = (task: Task, verb: string) => {
    void ctx.git.commit(`planner: ${verb} "${task.fields.title}"`, [task.path]);
    ctx.bus.emit({ kind: 'task-changed', path: task.path, task });
  };

  const record = (result: WriteResult, verb: string) => {
    if (!result.applied) return;
    void ctx.git.commit(`planner: ${verb} "${result.task.fields.title}"`, [result.diff.path]);
    ctx.bus.emit({ kind: 'task-changed', path: result.task.path, task: result.task });
  };

  app.get('/tasks', (c) => {
    try {
      const tasks = scope(c).tools.listTasks({
        status: c.req.query('status'),
        tag: c.req.query('tag'),
        q: c.req.query('q'),
        includeArchived: c.req.query('archived') === '1',
      });
      return c.json({ tasks });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get('/tasks/:id', (c) => {
    try {
      const { store, tools } = scope(c);
      const task = tools.getTask({ task: c.req.param('id') });
      return c.json({ task, problems: store.problemsFor(task.fields.id) });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get('/tasks/:id/raw', (c) => {
    try {
      const raw = scope(c).store.rawOf(c.req.param('id'));
      if (raw === undefined) return c.json({ error: 'No such task.', code: 'not_found' }, 404);
      return c.text(raw);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/tasks', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const result = await scope(c).tools.createTask(
        {
          title: String(body.title ?? ''),
          status: body.status as string | undefined,
          due: body.due as string | undefined,
          tags: body.tags as string | string[] | undefined,
          description: body.description as string | undefined,
        },
        !dry(c),
      );
      record(result, 'create');
      return c.json(result, result.applied ? 201 : 200);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/tasks/:id/log', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const result = await scope(c).tools.addLog(
        {
          task: c.req.param('id'),
          type: body.type as string | undefined,
          text: String(body.text ?? ''),
          at: body.at as string | undefined,
        },
        !dry(c),
      );
      record(result, 'log');
      return c.json(result);
    } catch (err) {
      return fail(c, err);
    }
  });

  /**
   * Editing and removing a comment. Not part of the seven task tools and not in the
   * model's schema — see `tools/comments.ts` for why. Applied directly, like lane edits,
   * because there is no model proposing them.
   */
  app.patch('/tasks/:id/log/:index', async (c) => {
    try {
      const body = await c.req.json<{ text?: string }>();
      const task = await scope(c).comments.edit(
        c.req.param('id'),
        Number(c.req.param('index')),
        String(body.text ?? ''),
      );
      recordDirect(task, 'edit comment on');
      return c.json({ task });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/tasks/:id/log/:index', async (c) => {
    try {
      const task = await scope(c).comments.remove(
        c.req.param('id'),
        Number(c.req.param('index')),
      );
      recordDirect(task, 'delete comment on');
      return c.json({ task });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch('/tasks/:id', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      const result = await scope(c).tools.setField(
        {
          task: c.req.param('id'),
          field: body.field as SetFieldName,
          value: body.value as string | string[],
        },
        !dry(c),
      );
      record(result, `set ${String(body.field)} on`);
      return c.json(result);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/tasks/:id/archive', async (c) => {
    try {
      const result = await scope(c).tools.archiveTask({ task: c.req.param('id') }, !dry(c));
      record(result, 'archive');
      return c.json(result);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/tasks/:id/restore', async (c) => {
    try {
      const result = await scope(c).tools.restoreTask({ task: c.req.param('id') }, !dry(c));
      record(result, 'restore');
      return c.json(result);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/tasks/:id', async (c) => {
    try {
      const { store, tools } = scope(c);
      const task = tools.getTask({ task: c.req.param('id') });
      await store.deleteTask(task.fields.id);
      await ctx.git.commit(`planner: delete "${task.fields.title}"`, [task.path]);
      ctx.bus.emit({ kind: 'task-removed', path: task.path });
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get('/search', (c) => {
    try {
      const matches = scope(c).tools.searchTasks({ query: c.req.query('q') ?? '' });
      return c.json({ matches });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get('/today', (c) => {
    try {
      return c.json(buildToday(scope(c).store.list()));
    } catch (err) {
      return fail(c, err);
    }
  });

  /**
   * History is only as real as the vault's git repo, so say plainly whether there is one.
   * An empty list with no explanation is what made this screen look broken.
   */
  app.get('/history', async (c) => {
    const repo = await ctx.git.isRepo();
    return c.json({
      repo,
      enabled: ctx.settings.gitUndo,
      gitInstalled: repo ? true : await ctx.git.gitInstalled(),
      commits: await ctx.git.lastCommits(30),
    });
  });

  /** Turn the vault into a repository. Always an explicit click, never a side effect. */
  app.post('/history/init', async (c) => {
    if (!ctx.settings.gitUndo) {
      return c.json({ error: 'Turn on "keep a git history" in Settings first.', code: 'invalid' }, 400);
    }
    const ok = await ctx.git.init();
    if (!ok) {
      return c.json(
        {
          error: 'Could not start a git repository in the vault.',
          code: 'invalid',
          detail: 'Check that git is installed and that you can write to the vault folder.',
        },
        400,
      );
    }
    return c.json({ ok: true, repo: true });
  });

  app.post('/history/:hash/revert', async (c) => {
    const ok = await ctx.git.revert(c.req.param('hash'));
    if (!ok) {
      return c.json(
        {
          error: 'Could not revert that change.',
          code: 'invalid',
          detail: 'It conflicts with something that changed later. Undo the newer change first.',
        },
        400,
      );
    }
    await ctx.vault.load();
    ctx.bus.emit({ kind: 'reindexed', count: ctx.vault.size });
    ctx.bus.emit({ kind: 'workspaces-changed', workspaces: ctx.vault.summaries() });
    return c.json({ ok: true });
  });

  return app;
}
