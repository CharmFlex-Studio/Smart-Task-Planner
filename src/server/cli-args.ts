/**
 * Parsing the command line.
 *
 * Kept separate from `cli.ts`, and pure, so every flag and every bad-input message can be
 * tested without starting a server or reading a real vault.
 */

export interface RunOptions {
  kind: 'run';
  port?: number;
  vault?: string;
  /** Open the browser once the server is listening. */
  open: boolean;
}

export type ParsedArgs =
  | RunOptions
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

export const HELP = `
  watsmytask — your tasks are a folder of markdown files.

  Usage
    watsmytask [options]

  Options
    -p, --port <number>   Port to listen on            (default 5123)
        --vault <path>    Folder to keep tasks in      (default ~/watsmytask-vault)
        --no-open         Do not open the browser
    -h, --help            Show this message
    -V, --version         Show the version

  Environment
    WATSMYTASK_PORT       Same as --port
    WATSMYTASK_VAULT      Same as --vault
    WATSMYTASK_AI_BASE_URL
                          Use an OpenAI-compatible server you already run,
                          e.g. http://127.0.0.1:11434/v1 for Ollama.
                          Loopback addresses only.

  The server binds to 127.0.0.1. Nothing it holds is reachable from another machine.
`;

/** Flags that take a value, so a missing value is reported rather than silently swallowed. */
const VALUE_FLAGS = new Set(['-p', '--port', '--vault']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: RunOptions = { kind: 'run', open: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    // `--port=5200` is the same as `--port 5200`.
    const eq = arg.indexOf('=');
    const [flag, inlineValue] =
      arg.startsWith('-') && eq > 1 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];

    let value = inlineValue;
    if (VALUE_FLAGS.has(flag) && value === undefined) {
      value = argv[++i];
      if (value === undefined) return { kind: 'error', message: `${flag} needs a value.` };
    }

    switch (flag) {
      case '-h':
      case '--help':
        return { kind: 'help' };
      case '-V':
      case '--version':
        return { kind: 'version' };
      case '-p':
      case '--port': {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return { kind: 'error', message: `"${value}" is not a port number between 1 and 65535.` };
        }
        options.port = port;
        break;
      }
      case '--vault': {
        if (!value!.trim()) return { kind: 'error', message: '--vault needs a folder path.' };
        options.vault = value!.trim();
        break;
      }
      case '--no-open':
        options.open = false;
        break;
      case '--open':
        options.open = true;
        break;
      default:
        return {
          kind: 'error',
          message: `Unknown option "${arg}". Run with --help to see what there is.`,
        };
    }
  }

  return options;
}
