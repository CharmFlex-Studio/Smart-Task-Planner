import type { Lane } from '@shared/types.js';

/**
 * The model's tool schema.
 *
 * This is the same seven task operations the UI uses, in the shape llama-server expects.
 * Deliberately flat and deliberately small: every extra tool and every extra optional
 * parameter measurably degrades a small model's ability to pick the right one. If a
 * feature needs an eighth tool, that is a reason to reconsider the feature.
 *
 * Note `task` is described as "title or id". Making the model reproduce a 26-character
 * ULID correctly is a needless failure mode; the server resolves fuzzy references and
 * refuses ambiguous ones, so the model can talk about tasks the way a person would.
 *
 * The lane names are baked in at build time rather than described in the abstract, because
 * a small model given `status: string` invents statuses and a small model given the list
 * picks from it. Editing the board is not offered at all: the columns are the user's.
 */

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const taskRef = {
  type: 'string',
  description: 'The task, given as its exact title, a distinctive part of the title, or its id.',
};

export const READ_TOOL_NAMES = ['list_tasks', 'get_task', 'search_tasks'] as const;
export const WRITE_TOOL_NAMES = ['create_task', 'add_log', 'set_field', 'archive_task'] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];
export type ToolName = ReadToolName | WriteToolName;

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

/** Built per request, because the lanes are whatever this user called their columns. */
export function toolSchemas(lanes: Lane[]): ToolSchema[] {
  const names = lanes.map((lane) => lane.name);
  const laneRef = {
    type: 'string',
    description: `The board column, one of: ${names.join(', ')}.`,
    enum: names,
  };
  return [
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description:
        'List tasks, most recently touched first. Use this to see what is open before answering questions about the current state of work.',
      parameters: {
        type: 'object',
        properties: {
          status: laneRef,
          tag: { type: 'string', description: 'Only tasks carrying this tag.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_task',
      description:
        'Read one task in full, including its whole progress log. Use this before summarizing a task or saying where work stopped.',
      parameters: {
        type: 'object',
        properties: { task: taskRef },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_tasks',
      description: 'Find tasks whose title, log or notes mention some text.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Words to look for.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new task. Only do this when the user clearly wants a new piece of work tracked.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, concrete title.' },
          status: laneRef,
          due: { type: 'string', description: 'Due date as YYYY-MM-DD.' },
          tags: { type: 'string', description: 'Comma-separated tags.' },
          description: { type: 'string', description: 'One or two sentences of context.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_log',
      description:
        'Add a comment to a task. This is the main way work gets recorded: prefer it over editing fields.',
      parameters: {
        type: 'object',
        properties: {
          task: taskRef,
          text: { type: 'string', description: 'What happened, in the user’s own words where possible.' },
        },
        required: ['task', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_field',
      description:
        `Change one field of a task. Setting status moves it to another column (${names.join(', ')}).`,
      parameters: {
        type: 'object',
        properties: {
          task: taskRef,
          field: { type: 'string', enum: ['title', 'status', 'due', 'tags', 'description'] },
          value: {
            type: 'string',
            description: 'The new value. An empty string clears due.',
          },
        },
        required: ['task', 'field', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'archive_task',
      description: 'Mark a task done and file it away. Only when the user says the work is finished.',
      parameters: {
        type: 'object',
        properties: { task: taskRef },
        required: ['task'],
      },
    },
  },
  ];
}
