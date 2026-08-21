import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

const IDENTITY = ['-c', 'user.name=planner', '-c', 'user.email=planner@localhost'];

/**
 * Git as the undo stack.
 *
 * When the vault is a git repository, every applied change becomes a commit. That gives
 * full history, `git revert` as undo and `git diff` as "what changed today" -- for about
 * eighty lines of code and no bespoke undo stack to keep correct.
 *
 * Entirely optional. A vault that is not a repo works exactly the same, minus the history,
 * and turning it into one is a single explicit action the user takes from the History tab.
 * We never run `git init` behind their back: making someone's folder a repository is not a
 * side effect anyone should discover later.
 */
export class GitUndo {
  private available: boolean | null = null;

  constructor(
    private readonly vault: string,
    private readonly enabled: () => boolean,
  ) {}

  /** True when the vault is a repo *and* history is switched on. */
  async isRepo(): Promise<boolean> {
    if (!this.enabled()) return false;
    if (this.available !== null) return this.available;
    try {
      const { stdout } = await run('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: this.vault,
      });
      this.available = stdout.trim() === 'true';
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /** Is git itself installed? Asked only to explain why history cannot be turned on. */
  async gitInstalled(): Promise<boolean> {
    try {
      await run('git', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Turn the vault into a repository and commit what is already there. Explicit, and
   * idempotent: a vault that is already a repo is left exactly as it is.
   */
  async init(): Promise<boolean> {
    if (await this.isRepo()) return true;
    if (!(await this.gitInstalled())) return false;
    try {
      await run('git', ['init', '-b', 'main'], { cwd: this.vault }).catch(() =>
        run('git', ['init'], { cwd: this.vault }),
      );
      this.available = null; // the answer just changed; ask again
      await this.commit('planner: start tracking this vault');
      return this.isRepo();
    } catch {
      this.available = null;
      return false;
    }
  }

  /**
   * Commit whatever changed in the vault. Best-effort by design: a failed commit must
   * never fail the write that already landed on disk, because the file is the truth and
   * the commit is only bookkeeping.
   */
  async commit(message: string, paths: string[] = ['.']): Promise<string | null> {
    if (!(await this.isRepo())) return null;
    try {
      await run('git', ['add', '--', ...paths.map((p) => path.normalize(p))], { cwd: this.vault });
      const { stdout } = await run(
        'git',
        [...IDENTITY, 'commit', '-m', message, '--no-verify'],
        { cwd: this.vault },
      );
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async lastCommits(limit = 20): Promise<{ hash: string; subject: string; date: string }[]> {
    if (!(await this.isRepo())) return [];
    try {
      const { stdout } = await run('git', ['log', `-${limit}`, '--pretty=format:%h\t%s\t%cI'], {
        cwd: this.vault,
      });
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash = '', subject = '', date = ''] = line.split('\t');
          return { hash, subject, date };
        });
    } catch {
      return [];
    }
  }

  async revert(hash: string): Promise<boolean> {
    if (!(await this.isRepo())) return false;
    try {
      await run('git', [...IDENTITY, 'revert', '--no-edit', hash], { cwd: this.vault });
      return true;
    } catch {
      // A revert can stop half-applied on a conflict; leave the tree the way it was.
      await run('git', ['revert', '--abort'], { cwd: this.vault }).catch(() => {});
      return false;
    }
  }
}
