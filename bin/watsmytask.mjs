#!/usr/bin/env node
/**
 * The published entry point.
 *
 * It is a wrapper rather than the compiled `cli.js` itself for one reason: the Node
 * version check has to happen before any modern syntax is parsed. On an old Node, importing
 * the real CLI first would fail with a syntax error pointing at a file the user has never
 * heard of, instead of telling them to upgrade Node.
 */

const MINIMUM = [20, 11]; // import.meta.dirname, and the fetch/AbortSignal.timeout we use.

const current = process.versions.node.split('.').map(Number);
const tooOld =
  current[0] < MINIMUM[0] || (current[0] === MINIMUM[0] && current[1] < MINIMUM[1]);

if (tooOld) {
  process.stderr.write(
    `\n  watsmytask needs Node ${MINIMUM.join('.')} or newer, and this is Node ${process.versions.node}.\n\n` +
      `  macOS    brew install node\n` +
      `  Windows  winget install OpenJS.NodeJS.LTS\n` +
      `  Or download the LTS installer from https://nodejs.org\n\n`,
  );
  process.exit(1);
}

await import('../dist/server/cli.js');
