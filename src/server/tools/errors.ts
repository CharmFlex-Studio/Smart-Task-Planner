export type ToolErrorCode = 'not_found' | 'invalid' | 'conflict' | 'ambiguous';

/** A failure the user (or the model) can act on, as opposed to a bug. */
export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
