/**
 * Shell-check every `run:` block in every workflow.
 *
 * YAML parsing says nothing about the script inside a block scalar, so a workflow can be
 * perfectly valid YAML and still contain an unterminated quote that only fails on the
 * runner, minutes into a release. This runs `bash -n` over each block so that failure
 * happens here instead.
 *
 * Usage: node .github/check-workflow-shell.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const DIR = '.github/workflows';
const scratch = mkdtempSync(path.join(tmpdir(), 'wf-shell-'));
let checked = 0;
let failed = 0;

/** GitHub expands ${{ … }} before bash ever sees it; substitute something inert. */
const deExpression = (s) => s.replace(/\$\{\{[^}]*\}\}/g, 'GHA_EXPR');

for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
  const doc = YAML.parse(readFileSync(path.join(DIR, file), 'utf8'));
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    for (const [i, step] of (job.steps ?? []).entries()) {
      if (typeof step.run !== 'string') continue;
      const shell = step.shell ?? job.defaults?.run?.shell ?? doc.defaults?.run?.shell ?? 'bash';
      if (!/^(bash|sh)$/.test(shell)) continue;

      const label = `${file} › ${jobName} › ${step.name ?? `step ${i + 1}`}`;
      const script = path.join(scratch, `s${checked}.sh`);
      writeFileSync(script, deExpression(step.run));
      checked++;
      try {
        execFileSync('bash', ['-n', script], { stdio: 'pipe' });
      } catch (err) {
        failed++;
        console.error(`\n  FAIL  ${label}`);
        console.error(
          String(err.stderr)
            .replace(new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '(script)')
            .split('\n')
            .filter(Boolean)
            .map((l) => `        ${l}`)
            .join('\n'),
        );
      }
    }
  }
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n  ${checked} run blocks checked, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
