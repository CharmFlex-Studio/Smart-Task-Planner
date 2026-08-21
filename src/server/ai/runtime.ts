import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { BIND_HOST } from '../config.js';

export type RuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface RuntimeOptions {
  binary: string;
  model: string;
  contextSize: number;
  logDir: string;
  idleTimeoutMs: number;
  keepLoaded: boolean;
  onStateChange?: (state: RuntimeState) => void;
}

/**
 * Owns the llama-server child process.
 *
 * The default posture is *not running*. A local planner that holds two gigabytes of model
 * resident all day to answer three questions is a bad neighbour on the machine it lives
 * on, so the model is loaded on the first request and dropped again after an idle period.
 * `keepLoaded` trades that RAM back for latency, and is off unless the user asks.
 *
 * Everything is loopback-only and the port is picked at random, so nothing here is
 * reachable from outside the machine.
 */
export class LlamaRuntime {
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private starting: Promise<number> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastUsed = 0;
  private state: RuntimeState = 'stopped';
  private lastError: string | undefined;

  constructor(private options: RuntimeOptions) {}

  update(patch: Partial<RuntimeOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  get currentState(): RuntimeState {
    return this.state;
  }
  get currentPort(): number | null {
    return this.port;
  }
  get error(): string | undefined {
    return this.lastError;
  }
  get idleMsRemaining(): number | undefined {
    if (this.state !== 'running' || this.options.keepLoaded) return undefined;
    return Math.max(0, this.options.idleTimeoutMs - (Date.now() - this.lastUsed));
  }

  private setState(state: RuntimeState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }

  /** Start if needed and return the base URL to talk to. */
  async ensure(): Promise<string> {
    this.touch();
    if (this.child && this.port && this.state === 'running') {
      return `http://${BIND_HOST}:${this.port}`;
    }
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    const port = await this.starting;
    return `http://${BIND_HOST}:${port}`;
  }

  private async start(): Promise<number> {
    if (!fs.existsSync(this.options.binary)) {
      throw new Error(`llama-server is not installed at ${this.options.binary}.`);
    }
    if (!fs.existsSync(this.options.model)) {
      throw new Error(`The model file is missing at ${this.options.model}.`);
    }

    this.setState('starting');
    this.lastError = undefined;
    const port = await freePort();

    fs.mkdirSync(this.options.logDir, { recursive: true });
    const logFile = path.join(this.options.logDir, 'llama-server.log');
    const log = fs.openSync(logFile, 'a');

    const child = spawn(
      this.options.binary,
      [
        '--model', this.options.model,
        '--host', BIND_HOST,
        '--port', String(port),
        '--ctx-size', String(this.options.contextSize),
        // --jinja makes llama-server use the model's own chat template, which is what
        // enables OpenAI-style tool calling for models that support it.
        '--jinja',
        '--no-webui',
      ],
      { stdio: ['ignore', log, log], detached: false },
    );

    child.on('exit', (code, signal) => {
      const wasRunning = this.state === 'running' || this.state === 'starting';
      this.child = null;
      this.port = null;
      if (wasRunning && this.state !== 'stopping') {
        this.lastError = `llama-server exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}). See ${logFile}.`;
        this.setState('error');
      } else {
        this.setState('stopped');
      }
    });
    child.on('error', (err) => {
      this.lastError = `Could not start llama-server: ${err.message}`;
      this.setState('error');
    });

    this.child = child;
    try {
      await waitForHealth(`http://${BIND_HOST}:${port}`, 90_000);
    } catch (err) {
      this.lastError = `${(err as Error).message} See ${logFile}.`;
      this.setState('error');
      await this.stop();
      throw new Error(this.lastError);
    }

    this.port = port;
    this.setState('running');
    this.touch();
    return port;
  }

  /** Mark the runtime as used, restarting the idle countdown. */
  touch(): void {
    this.lastUsed = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.options.keepLoaded) return;
    this.idleTimer = setTimeout(() => {
      void this.stop();
    }, this.options.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const child = this.child;
    if (!child) {
      this.setState('stopped');
      return;
    }
    this.setState('stopping');
    this.child = null;
    this.port = null;

    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000);
      kill.unref?.();
      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.setState('stopped');
  }
}

/** Ask the OS for a free loopback port by binding to 0 and reading back the assignment. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, BIND_HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port available.'))));
    });
  });
}

/** Poll `/health` until the model has finished loading. Cold-loading a 4 GB model is slow. */
export async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
      lastStatus = `HTTP ${res.status}`;
    } catch (err) {
      lastStatus = (err as Error).name === 'TimeoutError' ? 'timed out' : 'not listening yet';
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`llama-server did not become healthy within ${Math.round(timeoutMs / 1000)}s (${lastStatus}).`);
}
