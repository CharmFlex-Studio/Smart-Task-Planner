import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli-args.js';
import { browserCommand } from './open-browser.js';

describe('parseArgs', () => {
  it('defaults to running and opening the browser', () => {
    expect(parseArgs([])).toEqual({ kind: 'run', open: true });
  });

  it('reads a port as a separate argument or joined with =', () => {
    expect(parseArgs(['--port', '5200'])).toMatchObject({ port: 5200 });
    expect(parseArgs(['--port=5200'])).toMatchObject({ port: 5200 });
    expect(parseArgs(['-p', '5200'])).toMatchObject({ port: 5200 });
  });

  it('accepts the edges of the port range and rejects just outside them', () => {
    expect(parseArgs(['--port', '1'])).toMatchObject({ port: 1 });
    expect(parseArgs(['--port', '65535'])).toMatchObject({ port: 65535 });
    expect(parseArgs(['--port', '0'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--port', '65536'])).toMatchObject({ kind: 'error' });
  });

  it('rejects a port that is not a whole number', () => {
    expect(parseArgs(['--port', 'abc'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--port', '80.5'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--port', ''])).toMatchObject({ kind: 'error' });
  });

  it('reads a vault path and trims it', () => {
    expect(parseArgs(['--vault', '  ~/notes  '])).toMatchObject({ vault: '~/notes' });
  });

  it('rejects a blank vault path rather than defaulting silently', () => {
    expect(parseArgs(['--vault', '   '])).toMatchObject({ kind: 'error' });
  });

  it('reports a flag whose value is missing', () => {
    expect(parseArgs(['--port'])).toEqual({ kind: 'error', message: '--port needs a value.' });
    expect(parseArgs(['--vault'])).toEqual({ kind: 'error', message: '--vault needs a value.' });
  });

  it('turns the browser off, and back on', () => {
    expect(parseArgs(['--no-open'])).toMatchObject({ open: false });
    expect(parseArgs(['--no-open', '--open'])).toMatchObject({ open: true });
  });

  it('answers help and version before anything else', () => {
    expect(parseArgs(['--port', '5200', '--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['-V'])).toEqual({ kind: 'version' });
  });

  it('refuses an unknown option instead of ignoring it', () => {
    const result = parseArgs(['--collaborate']);
    expect(result.kind).toBe('error');
    expect(result).toMatchObject({ message: expect.stringContaining('--collaborate') });
  });

  it('combines several options', () => {
    expect(parseArgs(['--port', '6000', '--vault', '/tmp/v', '--no-open'])).toEqual({
      kind: 'run',
      port: 6000,
      vault: '/tmp/v',
      open: false,
    });
  });
});

describe('browserCommand', () => {
  const url = 'http://127.0.0.1:5123';

  it('uses the right opener per platform', () => {
    expect(browserCommand(url, 'darwin')).toEqual({ command: 'open', args: [url] });
    expect(browserCommand(url, 'linux')).toEqual({ command: 'xdg-open', args: [url] });
  });

  it('gives Windows an empty title, or start would treat the URL as one', () => {
    expect(browserCommand(url, 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', url],
    });
  });

  it('never hands the OS anything but a loopback http URL', () => {
    expect(browserCommand('http://example.com', 'darwin')).toBeNull();
    expect(browserCommand('file:///etc/passwd', 'darwin')).toBeNull();
    expect(browserCommand('not a url', 'darwin')).toBeNull();
    expect(browserCommand('http://localhost:5123', 'darwin')).not.toBeNull();
  });
});
