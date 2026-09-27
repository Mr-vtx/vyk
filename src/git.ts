import { execFileSync } from 'node:child_process';

export interface GitStatus {
  isRepo: boolean;
  isClean: boolean;
}

/**
 * Checks whether `projectRoot` is inside a git repo with no uncommitted
 * changes. Deliberately does NOT check for a `.git` folder directly in
 * `projectRoot` — a project can be a subdirectory of a repo rooted
 * higher up (a monorepo, or a client project folder sitting inside a
 * parent git repo), and git itself already knows how to walk up and find
 * that. Running `git status` directly and letting git resolve it is both
 * simpler and more correct than reimplementing that search.
 */
export function checkGitStatus(projectRoot: string): GitStatus {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { isRepo: true, isClean: output.trim().length === 0 };
  } catch {
    // Either git isn't installed, or it exited non-zero because
    // projectRoot (and everything above it) isn't a git repo at all.
    return { isRepo: false, isClean: false };
  }
}
