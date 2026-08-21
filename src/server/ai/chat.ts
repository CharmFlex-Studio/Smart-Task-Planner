import { randomUUID } from 'node:crypto';
import type { ChatMessage, Lane, ProposedChange, Task, WriteResult } from '@shared/types.js';
import type { PlannerTools } from '../tools/index.js';
import { ToolError } from '../tools/errors.js';
import { complete, parseToolArguments, type WireMessage } from './client.js';
import { toolSchemas, isWriteTool } from './schema.js';
import { renderList, renderTask, systemPrompt } from './context.js';
import path from 'node:path';
import type { AttachmentTools } from '../tools/attachments.js';
import { classifyAttachment, clampText, decodeText, describeSize } from './attachment-read.js';

/**
 * The tool-calling loop.
 *
 * The safety property that matters is here, in one branch: **read tools execute, write
 * tools only propose.** A write call is run as a dry run, turned into a diff, and handed
 * back for the user to approve. Nothing the model decides reaches the disk on its own.
 *
 * The second one is the scope: `tools` is bound to a single workspace before it gets here,
 * so every read the model can perform is a read of that workspace's folder. The prompt says
 * so too, but the prompt is a courtesy — the guarantee is that there is no object in this
 * function with a reference to any other workspace.
 *
 * That is what makes a 3B model an acceptable driver for this. It will sometimes pick the
 * wrong task or the wrong log type. The cost of that is a diff the user declines, rather
 * than a corrupted vault -- so the model can be merely useful instead of having to be
 * trustworthy.
 */

/** How many times the model may call tools before we make it answer. */
const MAX_TOOL_ROUNDS = 4;
/** How many messages of history to carry. Small models lose the thread in long contexts. */
const HISTORY_LIMIT = 10;

export interface ChatOptions {
  baseUrl: string;
  history: ChatMessage[];
  userText: string;
  /** The name of the one workspace this chat can see. */
  workspace: string;
  tasks: Task[];
  lanes: Lane[];
  /** Bound to that workspace: there is no reachable path to another one from here. */
  tools: PlannerTools;
  /** The same workspace's attachments. Bound the same way, for the same reason. */
  attachments: AttachmentTools;
  autoApply: boolean;
  now: Date;
  signal?: AbortSignal;
  model?: string;
}

export interface ChatOutcome {
  message: ChatMessage;
  /** Pending proposals, keyed by id, for the caller to hold until the user decides. */
  proposals: ProposedChange[];
}

export async function runChat(opts: ChatOptions): Promise<ChatOutcome> {
  const wire: WireMessage[] = [
    { role: 'system', content: systemPrompt(opts.tasks, opts.lanes, opts.workspace, opts.now) },
    ...opts.history.slice(-HISTORY_LIMIT).map(toWire),
    { role: 'user', content: opts.userText },
  ];

  const schemas = toolSchemas(opts.lanes);
  const proposals: ProposedChange[] = [];
  const reads: { name: string; args: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  let answer = '';
  let sentImages = false;

  /**
   * Ask the model, and if a picture is what broke it, ask again without one.
   *
   * Most local models cannot see. Sending an image to one is not a soft failure — the
   * server rejects the request — and losing the whole answer because a screenshot was
   * attached is a bad trade for a feature that is meant to be a bonus. So the images come
   * out, a line explaining that goes in, and the conversation carries on.
   */
  const ask = async (messages: WireMessage[]) => {
    try {
      return await complete(opts.baseUrl, {
        messages,
        tools: schemas,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      if (!sentImages) throw err;
      const withoutImages = stripImages(messages);
      sentImages = false;
      // Replace the wire in place, so later rounds do not send the pictures again.
      wire.length = 0;
      wire.push(...withoutImages);
      return await complete(opts.baseUrl, {
        messages: withoutImages,
        tools: schemas,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    }
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await ask(wire);

    if (result.toolCalls.length === 0) {
      answer = result.content.trim();
      break;
    }

    wire.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });

    const pendingImages: { name: string; mediaType: string; base64: string }[] = [];

    for (const call of result.toolCalls) {
      const name = call.function.name;
      const args = parseToolArguments(call.function.arguments);
      const fingerprint = `${name}:${JSON.stringify(args)}`;

      if (seen.has(fingerprint)) {
        wire.push(toolReply(call.id, name, 'You already made this exact call. Do not repeat it.'));
        continue;
      }
      seen.add(fingerprint);

      try {
        if (isWriteTool(name)) {
          const proposal = await propose(opts, name, args);
          proposals.push(proposal);
          wire.push(
            toolReply(
              call.id,
              name,
              proposal.state === 'applied'
                ? `Applied: ${proposal.summary}`
                : `Proposed to the user for approval: ${proposal.summary}. It is NOT saved yet. Do not call this again.`,
            ),
          );
        } else {
          reads.push({ name, args });
          const read = await executeRead(opts, name, args);
          wire.push(toolReply(call.id, name, read.text));
          // A tool result has nowhere to put a picture, so it arrives as the user showing
          // the model one. Queued until every tool call in this round has replied — a
          // user message wedged between an assistant's tool calls and their results is
          // not a conversation any server will accept.
          if (read.image) pendingImages.push(read.image);
        }
      } catch (err) {
        const message =
          err instanceof ToolError
            ? [err.message, err.hint].filter(Boolean).join(' ')
            : `That did not work: ${(err as Error).message}`;
        wire.push(toolReply(call.id, name, message));
      }
    }

    if (pendingImages.length > 0) {
      wire.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              pendingImages.length === 1
                ? `Here is ${pendingImages[0]!.name}.`
                : `Here are ${pendingImages.map((i) => i.name).join(', ')}.`,
          },
          ...pendingImages.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
          })),
        ],
      });
      sentImages = true;
    }

    // Out of rounds: ask for a plain answer with the tools withdrawn.
    if (round === MAX_TOOL_ROUNDS - 1) {
      const final = await complete(opts.baseUrl, {
        messages: [...wire, { role: 'user', content: 'Now answer in plain words, without using tools.' }],
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      answer = final.content.trim();
    }
  }

  if (!answer) {
    answer = proposals.length
      ? 'I have put the change below up for your approval.'
      : 'I could not work out an answer from your tasks.';
  }

  const message: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: answer,
    createdAt: opts.now.toISOString(),
    ...(reads.length ? { toolCalls: reads } : {}),
    ...(proposals.length ? { proposals } : {}),
  };
  return { message, proposals };
}

/**
 * The same conversation with the pictures taken out, and a note in their place.
 *
 * Said plainly so the model does not answer as though it saw something: without this it
 * has a message claiming an image is attached and no image, which is exactly the shape
 * that produces a confident description of a screenshot nobody sent.
 */
function stripImages(messages: WireMessage[]): WireMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string' || message.content === null) return message;
    const names = message.content
      .filter((part) => part.type === 'image_url')
      .map((_, i) => i)
      .length;
    const text = message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join(' ');
    return {
      ...message,
      content:
        `${text} (${names === 1 ? 'The image' : 'The images'} could not be shown: this model ` +
        `cannot read pictures. Say so rather than describing what you cannot see.)`,
    };
  });
}

/* ------------------------------------------------------------------ tools */

/**
 * A read tool's result: text for the model, and optionally a picture to show it.
 *
 * The picture is separate because a tool result has nowhere to put one — the wire format
 * has no image part for `role: tool`. The loop turns it into a follow-up user message.
 */
interface ReadResult {
  text: string;
  image?: { name: string; mediaType: string; base64: string };
}

async function executeRead(
  opts: ChatOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<ReadResult> {
  const { tools, lanes } = opts;
  switch (name) {
    case 'read_attachment':
      return readAttachment(opts.attachments, String(args.name ?? ''));
    case 'list_tasks':
      return {
        text: renderList(
          tools.listTasks({
            status: args.status as string | undefined,
            tag: args.tag as string | undefined,
          }),
          lanes,
        ),
      };
    case 'get_task':
      return { text: renderTask(tools.getTask({ task: String(args.task ?? '') }), lanes) };
    case 'search_tasks': {
      const matches = tools.searchTasks({ query: String(args.query ?? '') });
      return { text: renderList(matches.map((m) => m.task), lanes) };
    }
    default:
      return { text: `There is no tool called ${name}.` };
  }
}

/**
 * Read one attachment for the model.
 *
 * Text comes back as text. An image comes back as a picture for the loop to attach, and
 * as a line saying so — a model that cannot see will at least know something was there
 * rather than inventing what was in it. Anything else is refused by name and size, which
 * is more useful than a page of decoded binary.
 */
async function readAttachment(attachments: AttachmentTools, raw: string): Promise<ReadResult> {
  // Models tend to hand back the whole markdown target rather than the filename.
  const name = raw.trim().replace(/^!?\[.*?\]\((.*)\)$/, '$1').replace(/^(?:\.\/)?attachments\//, '');
  if (!name) return { text: 'No attachment name was given.' };

  const file = await attachments.read(name);
  if (!file) {
    const held = await attachments.list();
    return {
      text: held.length
        ? `There is no attachment called "${name}". This workspace has: ${held.map((a) => a.name).join(', ')}.`
        : `There is no attachment called "${name}". This workspace has none.`,
    };
  }

  const kind = classifyAttachment(name);
  const size = describeSize(file.body.byteLength);

  if (kind.kind === 'image') {
    return {
      text: `${name} is an image (${size}). It is attached to the next message.`,
      image: {
        name,
        mediaType: kind.mediaType,
        base64: Buffer.from(file.body).toString('base64'),
      },
    };
  }

  if (kind.kind === 'text') {
    const text = decodeText(file.body);
    if (text === null) {
      return { text: `${name} is named like a text file but its contents are binary (${size}).` };
    }
    return { text: `${name} (${size}):\n\n${clampText(text, name)}` };
  }

  return {
    text:
      `${name} is a ${path.extname(name) || 'file'} of ${size}, which cannot be read as ` +
      `text or shown as an image. Say so rather than guessing what is in it.`,
  };
}

/** Run a write tool as a dry run and package the diff for the user to approve. */
async function propose(
  opts: ChatOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<ProposedChange> {
  const apply = opts.autoApply;
  const result = await executeWrite(opts.tools, name, args, apply);
  return {
    id: randomUUID(),
    tool: name,
    args,
    diff: result.diff,
    summary: summarize(name, args, result),
    state: apply ? 'applied' : 'pending',
  };
}

export async function executeWrite(
  tools: PlannerTools,
  name: string,
  args: Record<string, unknown>,
  apply: boolean,
): Promise<WriteResult> {
  const task = String(args.task ?? '');
  switch (name) {
    case 'create_task':
      return tools.createTask(
        {
          title: String(args.title ?? ''),
          status: args.status as string | undefined,
          due: args.due as string | undefined,
          tags: args.tags as string | undefined,
          description: args.description as string | undefined,
        },
        apply,
      );
    case 'add_log':
      // No type: the model writes plain comments, exactly like the UI does.
      return tools.addLog({ task, text: String(args.text ?? '') }, apply);
    case 'set_field':
      return tools.setField(
        {
          task,
          field: args.field as never,
          value: (args.value ?? '') as string,
        },
        apply,
      );
    case 'archive_task':
      return tools.archiveTask({ task }, apply);
    default:
      throw new ToolError('invalid', `There is no tool called ${name}.`);
  }
}

/** A one-line description of a proposal, for the confirmation card and the chat transcript. */
export function summarize(
  name: string,
  args: Record<string, unknown>,
  result: WriteResult,
): string {
  const title = result.task.fields.title;
  switch (name) {
    case 'create_task':
      return `Create task "${title}"`;
    case 'add_log':
      return `Add a comment to "${title}"`;
    case 'set_field':
      return String(args.field) === 'status'
        ? `Move "${title}" to ${String(args.value ?? '')}`
        : `Set ${String(args.field)} of "${title}" to "${String(args.value ?? '')}"`;
    case 'archive_task':
      return `Mark "${title}" done and archive it`;
    default:
      return `Change "${title}"`;
  }
}

function toolReply(id: string, name: string, content: string): WireMessage {
  return { role: 'tool', tool_call_id: id, name, content };
}

function toWire(message: ChatMessage): WireMessage {
  return {
    role: message.role === 'tool' ? 'assistant' : message.role,
    content: message.content,
  };
}
