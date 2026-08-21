/**
 * Opening the user's browser at the planner.
 *
 * This is the one place the app shells out to the operating system, so the URL is never
 * passed through a shell: `open`/`xdg-open` get it as an argv entry, and on Windows the
 * `start` builtin gets an explicit empty title first, because `start "http://..."` would
 * otherwise treat the URL as the window title and open nothing.
 */

import { spawn } from 'node:child_process';

export interface OpenResult {
  opened: boolean;
  reason?: string;
}

/** Only ever hand the OS a loopback http(s) URL we built ourselves. */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  if (!isSafeUrl(url)) return null;
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * Best effort by design. A machine with no desktop session, or a locked-down browser
 * handler, must not stop the server from running — the URL is printed either way.
 */
export function openBrowser(url: string): OpenResult {
  const cmd = browserCommand(url);
  if (!cmd) return { opened: false, reason: 'refusing to open a non-loopback URL' };
  try {
    const child = spawn(cmd.command, cmd.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // A missing xdg-open is not an error worth crashing over.
    child.unref();
    return { opened: true };
  } catch (err) {
    return { opened: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
