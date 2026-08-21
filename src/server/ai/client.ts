import type { ToolSchema } from './schema.js';

/**
 * A minimal OpenAI-compatible chat client.
 *
 * Deliberately the *only* way this app talks to a model. Both llama-server and Ollama
 * expose `/v1/chat/completions`, so the same client works against a runtime we manage and
 * one the user already had running -- and there is exactly one place to look when the
 * conversation with the model goes wrong.
 */

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface CompletionResult {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string;
  /** Chain-of-thought, when a reasoning model emits it separately. Never shown to the user. */
  reasoning: string;
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

export interface CompletionOptions {
  messages: WireMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** A JSON schema the reply must satisfy. Enforced by the sampler, not by asking nicely. */
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Ignored by llama-server, required by Ollama. */
  model?: string;
  /**
   * Let a reasoning model think before answering. Off by default -- see the note in
   * `complete()`.
   */
  thinking?: boolean;
}

/**
 * Build the completions URL, tolerating both spellings of the base.
 *
 * llama-server is normally addressed as `http://127.0.0.1:PORT` while Ollama documents
 * its OpenAI surface as `http://127.0.0.1:11434/v1`. Both are things people will paste in,
 * and getting it wrong produces a bare 404 that looks like the model is broken. So we
 * normalize instead of insisting on one convention.
 */
export function completionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;
}

export async function complete(baseUrl: string, opts: CompletionOptions): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    // llama-server ignores the model name and serves whatever it was started with; it is
    // sent only because some OpenAI-compatible servers (Ollama) require the real name.
    model: opts.model ?? 'local',
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1200,
    stream: false,
  };

  /**
   * Turn off chain-of-thought unless explicitly asked for.
   *
   * Most current small models are reasoning models: they emit `reasoning_content` before
   * `content`, and left on, the whole token budget can go to thinking and come back with
   * an empty answer. Nothing this app asks for -- classify an update, append a log line,
   * summarize a short list -- benefits from it, and turning it off makes replies several
   * times faster and the token budget predictable. Tool calling is unaffected.
   *
   * Servers and templates that do not understand the kwarg ignore it.
   */
  if (!opts.thinking) {
    body.chat_template_kwargs = { enable_thinking: false };
  }
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.jsonSchema) {
    // Constrained decoding: the grammar makes malformed JSON structurally impossible,
    // rather than something we hope for and then have to parse defensively.
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema: opts.jsonSchema },
    };
  }

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(completionsUrl(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const name = (err as Error).name;
    throw new AiRequestError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'The model took too long to answer.'
        : 'Lost the connection to the local model.',
      'It may still be loading, or it may have crashed. Check the AI status panel.',
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AiRequestError(`The local model rejected the request (HTTP ${res.status}).`, detail.slice(0, 400));
  }

  const json = (await res.json()) as {
    choices?: {
      message?: WireMessage & { reasoning_content?: string };
      finish_reason?: string;
    }[];
  };
  const choice = json.choices?.[0];
  if (!choice?.message) {
    throw new AiRequestError('The local model returned an empty response.');
  }

  const content = choice.message.content ?? '';
  const reasoning = choice.message.reasoning_content ?? '';
  const finishReason = choice.finish_reason ?? 'stop';

  // An empty answer that used its whole budget thinking is a specific, fixable failure,
  // and saying "empty response" for it sends you looking in the wrong place.
  if (!content && !choice.message.tool_calls?.length && reasoning && finishReason === 'length') {
    throw new AiRequestError(
      'The model spent its whole reply thinking and never answered.',
      'It is a reasoning model that ignored the request to skip chain-of-thought. Try a larger token budget, or a different model.',
    );
  }

  return {
    content,
    reasoning,
    toolCalls: choice.message.tool_calls ?? [],
    finishReason,
  };
}

/** Tool arguments arrive as a JSON string and are not guaranteed to be valid JSON. */
export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * What the connected server can serve.
 *
 * Ollama and llama-server both expose this. It is what lets the picker offer models the
 * user already pulled, instead of asking them to download a second copy of one.
 */
export async function listServerModels(baseUrl: string, timeoutMs = 8000): Promise<string[]> {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const res = await fetch(`${root}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new AiRequestError(`The model server returned HTTP ${res.status}.`);
  const json = (await res.json()) as { data?: { id?: string }[] };
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
}
