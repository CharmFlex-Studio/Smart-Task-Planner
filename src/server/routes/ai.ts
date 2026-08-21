import { Hono } from 'hono';
import type { PlannerContext } from '../context.js';
import { fail } from './errors.js';
import {
  HuggingFaceError,
  listGgufFiles,
  searchGgufRepos,
  toolCallingForSize,
} from '../ai/huggingface.js';
import type { ChatMessage } from '@shared/types.js';

/**
 * The AI routes.
 *
 * Chat is a plain request/response rather than a streamed one: a small local model answers
 * a planner question in a few seconds, and the interesting output -- a proposed diff -- is
 * not useful half-rendered. Install is the long-running operation and reports through the
 * same SSE stream the vault uses, so there is one place to watch.
 *
 * The model-browsing routes are the only ones in the app that reach a non-loopback host,
 * and only ever from an explicit click in the picker. No task data goes with them.
 */
export function aiRoutes(ctx: PlannerContext): Hono {
  const app = new Hono();

  app.get('/ai/status', (c) =>
    c.json({ status: ctx.ai.status(), unverifiedDownload: ctx.ai.integrityUnverified }),
  );

  /** What can be selected right now, plus starting points for finding more. */
  app.get('/ai/models', async (c) => {
    try {
      return c.json(await ctx.ai.listModels());
    } catch (err) {
      return fail(c, err);
    }
  });

  /** Search Hugging Face for GGUF repositories. */
  app.get('/ai/models/search', async (c) => {
    const q = c.req.query('q') ?? '';
    try {
      const repos = await searchGgufRepos(q);
      return c.json({
        repos: repos.map((r) => ({ ...r, toolCalling: toolCallingForSize(r.repo).level })),
      });
    } catch (err) {
      if (err instanceof HuggingFaceError) {
        return c.json({ error: err.message, code: 'invalid', detail: err.hint }, 400);
      }
      return fail(c, err);
    }
  });

  /** The quantizations available in one repo, with their real sizes. */
  app.get('/ai/models/files', async (c) => {
    const repo = c.req.query('repo') ?? '';
    try {
      const files = await listGgufFiles(repo);
      return c.json({ repo, files, toolCalling: toolCallingForSize(repo).level });
    } catch (err) {
      if (err instanceof HuggingFaceError) {
        return c.json({ error: err.message, code: 'invalid', detail: err.hint }, 400);
      }
      return fail(c, err);
    }
  });

  app.post('/ai/install', async (c) => {
    try {
      const body = await c.req.json<{ repo?: string; file?: string }>();
      if (!body.file) {
        return c.json({ error: 'Pick a model file first.', code: 'invalid' }, 400);
      }
      if (!body.repo) {
        const status = ctx.ai.status();
        if (!status.modelInstalled || status.modelName !== body.file) {
          return c.json(
            {
              error: 'That model is not the selected downloaded model.',
              code: 'invalid',
            },
            400,
          );
        }
      }
      if (ctx.ai.isInstalling()) {
        return c.json({ error: 'An install is already running.', code: 'invalid' }, 400);
      }
      // Kick it off and return immediately; progress arrives over /api/events.
      void ctx.ai
        .install(body.repo, body.file)
        .then((file) => ctx.updateSettings({ modelFile: file }))
        .catch((err: unknown) => console.error('[watsmytask] model install failed:', err));
      return c.json({ started: true, ...(body.repo ? { repo: body.repo } : {}), file: body.file }, 202);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/ai/install/cancel', (c) => {
    ctx.ai.cancelInstall();
    return c.json({ ok: true });
  });

  app.delete('/ai/models/:file', async (c) => {
    try {
      await ctx.ai.removeModel(decodeURIComponent(c.req.param('file')));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message, code: 'invalid' }, 400);
    }
  });

  app.post('/ai/stop', async (c) => {
    await ctx.ai.stop();
    return c.json({ ok: true });
  });

  app.post('/ai/chat', async (c) => {
    try {
      const body = await c.req.json<{ text?: string; history?: ChatMessage[] }>();
      const text = (body.text ?? '').trim();
      if (!text) return c.json({ error: 'Say something first.', code: 'invalid' }, 400);

      const status = ctx.ai.status();
      if (!status.runtimeInstalled || !status.modelInstalled) {
        return c.json(
          {
            error: 'No local model is set up yet.',
            code: 'ai_unavailable',
            detail: 'Pick or download one in Settings to use chat.',
          },
          400,
        );
      }
      // The workspace is resolved here, before the model is involved, so an id it could
      // never have seen is the only thing that decides what the chat can read.
      const workspace = ctx.scope(c.req.query('ws')).id;
      return c.json({ message: await ctx.ai.chat(text, body.history ?? [], workspace) });
    } catch (err) {
      return c.json({ error: (err as Error).message, code: 'ai_unavailable' }, 503);
    }
  });

  app.post('/ai/proposals/:id/apply', async (c) => {
    try {
      const result = await ctx.ai.applyProposal(c.req.param('id'));
      if (!result.ok) {
        return c.json(
          {
            proposal: result.proposal,
            changed: true,
            error: 'The file changed since this was drafted. Here is the updated diff.',
          },
          409,
        );
      }
      await ctx.git.commit(`planner (ai): ${result.proposal.summary}`, [result.proposal.diff.path]);
      return c.json({ proposal: result.proposal });
    } catch (err) {
      return c.json({ error: (err as Error).message, code: 'invalid' }, 400);
    }
  });

  app.post('/ai/proposals/:id/discard', (c) =>
    c.json({ ok: ctx.ai.discardProposal(c.req.param('id')) }),
  );

  return app;
}
