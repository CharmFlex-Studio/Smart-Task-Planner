import type { Context } from 'hono';
import type { ApiError } from '@shared/types.js';
import { ToolError } from '../tools/errors.js';
import { ConflictError, NotFoundError } from '../vault/store.js';
import { UnknownWorkspaceError } from '../vault/vault.js';

/**
 * One place that turns an internal failure into an HTTP response.
 *
 * Errors the user can act on keep their message; anything else is reported as an internal
 * error with the detail logged server-side, so a stack trace never reaches the browser.
 */
export function toApiError(err: unknown): { status: 400 | 404 | 409 | 500; body: ApiError } {
  if (err instanceof ToolError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400;
    return {
      status,
      body: {
        error: err.message,
        code: err.code === 'ambiguous' ? 'invalid' : err.code,
        ...(err.hint ? { detail: err.hint } : {}),
      },
    };
  }
  if (err instanceof ConflictError) {
    return { status: 409, body: { error: err.message, code: 'conflict' } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: err.message, code: 'not_found' } };
  }
  if (err instanceof UnknownWorkspaceError) {
    return {
      status: 404,
      body: {
        error: err.message,
        code: 'not_found',
        detail: 'It may have been renamed or removed. Reload to see the current list.',
      },
    };
  }
  console.error('[watsmytask] unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Something went wrong. Check the server log.', code: 'internal' },
  };
}

export function fail(c: Context, err: unknown) {
  const { status, body } = toApiError(err);
  return c.json(body, status);
}
