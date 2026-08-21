import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { externalAiBaseUrl, externalAiModel, resolvePaths, serverPort, BIND_HOST } from './config.js';

afterEach(() => vi.restoreAllMocks());

describe('the network policy is loopback-only', () => {
  it('binds to 127.0.0.1 and nothing else', () => {
    // The single most important constant in the app: there is no authentication, and that
    // is only acceptable because nothing off this machine can reach the server.
    expect(BIND_HOST).toBe('127.0.0.1');
  });

  it('accepts a loopback AI server', () => {
    expect(externalAiBaseUrl({ PLANNER_AI_BASE_URL: 'http://127.0.0.1:11434/v1' })).toBe(
      'http://127.0.0.1:11434/v1',
    );
    expect(externalAiBaseUrl({ PLANNER_AI_BASE_URL: 'http://localhost:8080/v1' })).toBe(
      'http://localhost:8080/v1',
    );
  });

  it('refuses to send task data to a remote AI server, however it is spelled', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const url of [
      'https://api.openai.com/v1',
      'http://192.168.1.50:11434/v1',
      'http://model.internal.corp/v1',
      'http://127.0.0.1.evil.com/v1',
    ]) {
      expect(externalAiBaseUrl({ PLANNER_AI_BASE_URL: url })).toBeNull();
    }
  });

  it('ignores a malformed url rather than crashing at startup', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(externalAiBaseUrl({ PLANNER_AI_BASE_URL: 'not a url' })).toBeNull();
  });

  it('is off unless explicitly set', () => {
    expect(externalAiBaseUrl({})).toBeNull();
  });

  it('resolves the external model name by precedence: setting, then env, then a placeholder', () => {
    // llama-server ignores the name entirely; Ollama needs the real one.
    expect(externalAiModel({}, {})).toBe('local');
    expect(externalAiModel({}, { PLANNER_AI_MODEL: 'qwen3.5:4b' })).toBe('qwen3.5:4b');
    // A model picked in the UI wins over the launch-time env var.
    expect(externalAiModel({ externalModel: 'gemma4:e4b' }, { PLANNER_AI_MODEL: 'qwen3.5:4b' })).toBe(
      'gemma4:e4b',
    );
    expect(externalAiModel({ externalModel: '  ' }, { PLANNER_AI_MODEL: 'qwen3.5:4b' })).toBe(
      'qwen3.5:4b',
    );
  });
});

describe('paths', () => {
  it('keeps the vault and the app cache apart', () => {
    const p = resolvePaths({ WATSMYTASK_VAULT: '/tmp/v', WATSMYTASK_HOME: '/tmp/h' });
    expect(p.meta).toBe(path.join('/tmp/v', '.watsmytask'));
    expect(p.models).toBe(path.join('/tmp/h', 'models'));
    // Downloaded models must never land inside the user's notes folder.
    expect(p.models.startsWith(p.vault)).toBe(false);
  });

  it('expands a leading ~ to the home directory', () => {
    const p = resolvePaths({ WATSMYTASK_VAULT: '~/notes' });
    expect(p.vault).toBe(path.join(os.homedir(), 'notes'));
  });

  it('still honours the PLANNER_ names the app used to be configured with', () => {
    const p = resolvePaths({ PLANNER_VAULT: '/tmp/v', PLANNER_HOME: '/tmp/h' });
    expect(p.vault).toBe(path.resolve('/tmp/v'));
    expect(p.appData).toBe(path.resolve('/tmp/h'));
    expect(serverPort({ PLANNER_PORT: '8080' })).toBe(8080);
  });

  it('prefers the new name when both are set', () => {
    const p = resolvePaths({ WATSMYTASK_VAULT: '/tmp/new', PLANNER_VAULT: '/tmp/old' });
    expect(p.vault).toBe(path.resolve('/tmp/new'));
    expect(serverPort({ WATSMYTASK_PORT: '8080', PLANNER_PORT: '9090' })).toBe(8080);
  });
});

/**
 * The rename must not lose anyone's work. These pin the rule down on real folders,
 * because the failure they guard against — an existing vault going quietly invisible and
 * the app opening on an empty board — is indistinguishable from data loss to the person
 * it happens to.
 */
describe('a vault named before the app was renamed', () => {
  let home = '';

  beforeEach(async () => {
    home = await fsp.mkdtemp(path.join(os.tmpdir(), 'wmt-home-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });

  afterEach(async () => {
    await fsp.rm(home, { recursive: true, force: true });
  });

  it('is used where it already is, and is never moved', () => {
    const legacy = path.join(home, 'planner-vault');
    fs.mkdirSync(legacy, { recursive: true });

    const p = resolvePaths({});

    expect(p.vault).toBe(legacy);
    // Nothing was created under the new name, and nothing was relocated.
    expect(fs.existsSync(path.join(home, 'watsmytask-vault'))).toBe(false);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('keeps its .planner metadata folder, so its settings keep being read', () => {
    const legacy = path.join(home, 'planner-vault');
    fs.mkdirSync(path.join(legacy, '.planner'), { recursive: true });

    const p = resolvePaths({});

    expect(p.meta).toBe(path.join(legacy, '.planner'));
    expect(p.settingsFile).toBe(path.join(legacy, '.planner', 'config.json'));
  });

  it('keeps a downloaded model cache rather than stranding gigabytes of it', () => {
    fs.mkdirSync(path.join(home, '.planner', 'models'), { recursive: true });
    expect(resolvePaths({}).appData).toBe(path.join(home, '.planner'));
  });

  it('gives a fresh machine the new names', () => {
    const p = resolvePaths({});
    expect(p.vault).toBe(path.join(home, 'watsmytask-vault'));
    expect(p.appData).toBe(path.join(home, '.watsmytask'));
    expect(p.meta).toBe(path.join(home, 'watsmytask-vault', '.watsmytask'));
  });

  it('prefers the new name once it exists, even beside the old one', () => {
    fs.mkdirSync(path.join(home, 'planner-vault'), { recursive: true });
    fs.mkdirSync(path.join(home, 'watsmytask-vault'), { recursive: true });
    expect(resolvePaths({}).vault).toBe(path.join(home, 'watsmytask-vault'));
  });

  it('lets an explicit setting override the whole question', () => {
    fs.mkdirSync(path.join(home, 'planner-vault'), { recursive: true });
    expect(resolvePaths({ WATSMYTASK_VAULT: '/tmp/elsewhere' }).vault).toBe(
      path.resolve('/tmp/elsewhere'),
    );
  });
});

describe('port', () => {
  it('falls back to the default for nonsense', () => {
    expect(serverPort({ PLANNER_PORT: 'banana' })).toBe(5123);
    expect(serverPort({ PLANNER_PORT: '99999' })).toBe(5123);
    expect(serverPort({ PLANNER_PORT: '8080' })).toBe(8080);
  });
});

describe('completions url', () => {
  it('tolerates a base with or without /v1, so a pasted Ollama url just works', async () => {
    const { completionsUrl } = await import('./ai/client.js');
    const expected = 'http://127.0.0.1:11434/v1/chat/completions';
    expect(completionsUrl('http://127.0.0.1:11434')).toBe(expected);
    expect(completionsUrl('http://127.0.0.1:11434/v1')).toBe(expected);
    expect(completionsUrl('http://127.0.0.1:11434/v1/')).toBe(expected);
  });
});
