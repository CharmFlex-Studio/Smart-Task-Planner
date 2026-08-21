#!/usr/bin/env node
/**
 * The installed `watsmytask` command.
 *
 * Everything a double-clicked launcher needs and the dev server does not: flags, a
 * readable message when the port is busy, and opening the browser. The interesting work
 * is in `startPlanner`; this file is about the first thirty seconds of someone's day.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIND_HOST } from './config.js';
import { startPlanner, installShutdownHandlers, type RunningPlanner } from './index.js';
import { parseArgs, HELP } from './cli-args.js';
import { openBrowser } from './open-browser.js';

/** Read the version out of our own package.json rather than repeating it in the source. */
function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server/cli.js and src/server/cli.ts are both two levels below the package root.
  const file = path.resolve(here, '../../package.json');
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Is a planner already listening there?
 *
 * A launcher gets double-clicked. Rather than failing with EADDRINUSE, ask whether the
 * thing on that port is one of ours and, if so, just show the user the window they wanted.
 */
async function plannerAlreadyOn(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${BIND_HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; vault?: string };
    return body.ok === true && typeof body.vault === 'string';
  } catch {
    return false;
  }
}

function isPortTaken(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'EADDRINUSE';
}

/**
 * Keep the planner alive when something optional falls over.
 *
 * Node exits the process on an unhandled rejection, which means a promise nobody caught
 * — a request in flight to llama-server when it dies, a model download losing its
 * connection — takes the task server with it. That is the wrong trade for this app: the
 * AI is a plugin and the planner is meant to work without it, so a model crashing must
 * not close the window on someone's notes.
 *
 * Logged loudly rather than swallowed. Something that reaches here is a bug worth fixing;
 * it is just not worth losing the vault server over.
 */
function keepAliveThroughPluginFailures(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('\n[watsmytask] a background task failed and was not handled:');
    console.error(reason instanceof Error ? (reason.stack ?? reason.message) : reason);
    console.error('[watsmytask] the planner is still running. Your tasks are unaffected.\n');
  });

  // An uncaught synchronous throw is a different matter: the state it left behind is
  // unknown, so this says what happened in words and then goes, rather than dying with a
  // stack trace and no explanation.
  process.on('uncaughtException', (err) => {
    console.error('\n[watsmytask] stopped by an unexpected error:');
    console.error(err.stack ?? err.message);
    console.error('\n[watsmytask] your tasks are markdown files and are unaffected.\n');
    process.exit(1);
  });
}

async function main(): Promise<void> {
  keepAliveThroughPluginFailures();

  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.kind === 'help') return void console.log(HELP);
  if (parsed.kind === 'version') return void console.log(version());
  if (parsed.kind === 'error') {
    console.error(`\n  ${parsed.message}\n`);
    process.exit(2);
  }

  // Flags win over the environment; `resolvePaths`/`serverPort` read both from here.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (parsed.port !== undefined) env.WATSMYTASK_PORT = String(parsed.port);
  if (parsed.vault !== undefined) env.WATSMYTASK_VAULT = parsed.vault;

  const wanted = Number(env.WATSMYTASK_PORT ?? env.PLANNER_PORT ?? 5123);
  const url = (port: number) => `http://${BIND_HOST}:${port}`;

  // Someone double-clicked the launcher twice. Show them the planner, do not scold them.
  //
  // Only when we were going to open a browser anyway, which is exactly the double-click
  // case. With `--no-open` the caller wants a server *in this process* — `tsx watch`
  // restarting into a port its dying predecessor still holds must fail loudly and be
  // restarted, not quietly decide the old one will do and exit.
  if (parsed.open && (await plannerAlreadyOn(wanted))) {
    console.log(`\n  watsmytask is already running.\n\n  open    ${url(wanted)}\n`);
    if (parsed.open) openBrowser(url(wanted));
    return;
  }

  let planner: RunningPlanner;
  try {
    planner = await startPlanner(env);
  } catch (err) {
    if (isPortTaken(err)) {
      console.error(
        `\n  Port ${wanted} is being used by something else.\n` +
          `  Start the planner on another port:  watsmytask --port ${wanted + 1}\n`,
      );
      process.exit(1);
    }
    console.error('\n  The planner could not start.\n');
    console.error(err instanceof Error ? `  ${err.message}\n` : err);
    process.exit(1);
  }

  installShutdownHandlers(planner);

  console.log(`\n  watsmytask\n`);
  console.log(`  vault   ${planner.vault}`);
  console.log(`  tasks   ${planner.tasks} loaded in ${planner.workspaces} workspace(s)`);
  console.log(`  open    ${url(planner.port)}`);
  console.log(`\n  Your tasks are plain markdown in the folder above. Ctrl-C to stop.\n`);

  if (parsed.open) {
    const result = openBrowser(url(planner.port));
    if (!result.opened) console.log(`  (Could not open a browser: ${result.reason})\n`);
  }
}

main().catch((err: unknown) => {
  console.error('[watsmytask] failed to start:', err);
  process.exit(1);
});
