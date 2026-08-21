import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../vault/vault.js';
import { resolvePaths } from '../config.js';
import { makeScope, type Scope } from '../context.js';
import { runChat } from './chat.js';

/** Distinctive on purpose: the system prompt itself says "private notes". */
const SENTINEL = 'zzq-do-not-leak-7f3a';

/**
 * The attachment reading path, end to end against a stubbed model.
 *
 * Stubbed rather than mocked, because the thing worth checking is what actually goes over
 * the wire: an image has nowhere to live in a tool result, so it has to arrive as a
 * follow-up user message, and that only works if it is built in the shape a server
 * accepts.
 */

let dir: string;
let vault: Vault;
let scope: Scope;
let server: http.Server;
let baseUrl: string;
/** Every request body the "model" received, in order. */
let seen: Record<string, unknown>[];
/** Canned replies, one per round. */
let replies: unknown[];
/** When true, the stub refuses any request carrying an image — a model that cannot see. */
let refuseImages = false;

const NOW = new Date('2026-08-21T12:00:00');

const say = (content: string) => ({
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
});
const callTool = (name: string, args: Record<string, unknown>) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
});

const hasImage = (body: Record<string, unknown>): boolean =>
  JSON.stringify(body.messages ?? []).includes('"image_url"');

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'att-chat-'));
  await fs.mkdir(path.join(dir, 'main', 'tasks'), { recursive: true });
  await fs.mkdir(path.join(dir, 'main', 'attachments'), { recursive: true });
  await fs.mkdir(path.join(dir, 'other', 'tasks'), { recursive: true });
  await fs.mkdir(path.join(dir, 'other', 'attachments'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'main', 'board.md'),
    '---\nname: "Main"\nlanes:\n  - id: todo\n    name: To Do\n---\n',
  );
  await fs.writeFile(
    path.join(dir, 'other', 'board.md'),
    '---\nname: "Other"\nlanes:\n  - id: todo\n    name: To Do\n---\n',
  );
  await fs.writeFile(
    path.join(dir, 'main', 'tasks', 't.md'),
    '---\nid: t1\ntitle: Has attachments\nstatus: todo\n---\n\nSee ![shot.png](attachments/shot.png) and [log.txt](attachments/log.txt).\n',
  );
  await fs.writeFile(path.join(dir, 'main', 'attachments', 'log.txt'), 'line one\nline two\n');
  // A real PNG header is enough; nothing decodes it here.
  await fs.writeFile(
    path.join(dir, 'main', 'attachments', 'shot.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
  );
  await fs.writeFile(path.join(dir, 'main', 'attachments', 'archive.zip'), 'PK\x03\x04binary');
  await fs.writeFile(path.join(dir, 'other', 'attachments', 'secret.txt'), SENTINEL);

  vault = new Vault(resolvePaths({ WATSMYTASK_VAULT: dir, WATSMYTASK_HOME: path.join(dir, '.app') }));
  await vault.load();
  scope = makeScope(vault, 'main');

  seen = [];
  replies = [];
  refuseImages = false;

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      seen.push(parsed);
      if (refuseImages && hasImage(parsed)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'this model does not support images' } }));
        return;
      }
      const reply = replies.shift() ?? say('done');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(dir, { recursive: true, force: true });
});

const chat = (userText: string) =>
  runChat({
    baseUrl,
    history: [],
    userText,
    workspace: scope.name,
    tasks: scope.store.list(NOW),
    lanes: scope.store.lanes(),
    tools: scope.tools,
    attachments: scope.attachments,
    autoApply: false,
    now: NOW,
  });

describe('reading a text attachment', () => {
  it('gives the model the contents', async () => {
    replies = [callTool('read_attachment', { name: 'log.txt' }), say('It has two lines.')];
    await chat('what does log.txt say?');
    const toolReply = JSON.stringify(seen[1]!.messages);
    expect(toolReply).toContain('line one');
    expect(toolReply).toContain('line two');
  });

  it('accepts the whole markdown target, which is what models tend to send', async () => {
    replies = [
      callTool('read_attachment', { name: '![log.txt](attachments/log.txt)' }),
      say('ok'),
    ];
    await chat('read it');
    expect(JSON.stringify(seen[1]!.messages)).toContain('line one');
  });

  it('says what a file is when it cannot be read, rather than decoding it', async () => {
    replies = [callTool('read_attachment', { name: 'archive.zip' }), say('ok')];
    await chat('read the zip');
    const reply = JSON.stringify(seen[1]!.messages);
    expect(reply).toContain('cannot be read');
    expect(reply).not.toContain('PK');
  });

  it('lists what is there when the name is wrong', async () => {
    replies = [callTool('read_attachment', { name: 'nope.txt' }), say('ok')];
    await chat('read nope.txt');
    const reply = JSON.stringify(seen[1]!.messages);
    expect(reply).toContain('no attachment called');
    expect(reply).toContain('log.txt');
  });
});

describe('showing the model an image', () => {
  it('sends it as a follow-up user message, because a tool result cannot carry one', async () => {
    replies = [callTool('read_attachment', { name: 'shot.png' }), say('A purple square.')];
    await chat('what is in the screenshot?');

    const second = seen[1]!.messages as { role: string; content: unknown }[];
    const withImage = second.find(
      (m) => Array.isArray(m.content) && m.content.some((p: { type: string }) => p.type === 'image_url'),
    );
    expect(withImage).toBeDefined();
    expect(withImage!.role).toBe('user');

    const part = (withImage!.content as { type: string; image_url?: { url: string } }[]).find(
      (p) => p.type === 'image_url',
    );
    expect(part!.image_url!.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('puts the image after the tool result, never between a call and its reply', async () => {
    replies = [callTool('read_attachment', { name: 'shot.png' }), say('ok')];
    await chat('look');
    const roles = (seen[1]!.messages as { role: string }[]).map((m) => m.role);
    expect(roles.indexOf('tool')).toBeLessThan(roles.lastIndexOf('user'));
  });
});

/**
 * Most local models cannot see. Losing the whole answer because a screenshot was attached
 * would be a bad trade for what is meant to be a bonus.
 */
describe('a model that cannot read pictures', () => {
  it('retries without the image instead of failing the chat', async () => {
    refuseImages = true;
    replies = [callTool('read_attachment', { name: 'shot.png' }), say('I cannot see images.')];
    const out = await chat('what is in the screenshot?');
    expect(out.message.content).toBe('I cannot see images.');
  });

  it('tells the model the image is missing, so it does not describe one', async () => {
    refuseImages = true;
    replies = [callTool('read_attachment', { name: 'shot.png' }), say('ok')];
    await chat('look');
    const retried = seen[seen.length - 1]!;
    expect(JSON.stringify(retried.messages)).toContain('cannot read pictures');
    expect(JSON.stringify(retried.messages)).not.toContain('image_url');
  });
});

describe('the workspace boundary still holds', () => {
  it('cannot read an attachment belonging to another workspace', async () => {
    replies = [callTool('read_attachment', { name: 'secret.txt' }), say('ok')];
    await chat('read secret.txt');
    const reply = JSON.stringify(seen[1]!.messages);
    expect(reply).toContain('no attachment called');
    expect(reply).not.toContain(SENTINEL);
  });

  it('cannot climb out of the folder with a path', async () => {
    replies = [callTool('read_attachment', { name: '../../other/attachments/secret.txt' }), say('ok')];
    await chat('read it');
    expect(JSON.stringify(seen[1]!.messages)).not.toContain(SENTINEL);
  });
});
