import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from './scanner';
import { checkGitStatus } from './git';
import { checkNativeBinding } from './native';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

const MIN_NODE_MAJOR = 18;

export function checkNodeVersion(nodeVersion: string = process.versions.node): DoctorCheck {
  const major = Number(nodeVersion.split('.')[0]);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) {
    return { name: 'Node.js version', status: 'ok', message: `v${nodeVersion}` };
  }
  return {
    name: 'Node.js version',
    status: 'fail',
    message: `v${nodeVersion} — Vysk requires Node.js ${MIN_NODE_MAJOR}+`,
  };
}

function checkNativeAddon(): DoctorCheck {
  const result = checkNativeBinding();
  return {
    name: 'Native addon',
    status: result.ok ? 'ok' : 'fail',
    message: result.message,
  };
}

function checkGit(projectRoot: string | undefined): DoctorCheck {
  if (!projectRoot) {
    return { name: 'Git', status: 'warn', message: 'skipped — no project root found' };
  }
  const status = checkGitStatus(projectRoot);
  if (!status.isRepo) {
    return {
      name: 'Git',
      status: 'warn',
      message: 'not a git repository — `rewrite`/`clean`/`undo` will refuse to run without --force',
    };
  }
  return {
    name: 'Git',
    status: status.isClean ? 'ok' : 'warn',
    message: status.isClean ? 'clean working tree' : 'uncommitted changes present',
  };
}

function checkCache(projectRoot: string | undefined): DoctorCheck {
  if (!projectRoot) {
    return { name: 'Cache', status: 'warn', message: 'skipped — no project root found' };
  }
  const cachePath = join(projectRoot, '.vysk', 'cache.json');
  if (!existsSync(cachePath)) {
    return { name: 'Cache', status: 'ok', message: 'no cache yet — will be created on first run' };
  }
  try {
    JSON.parse(readFileSync(cachePath, 'utf8'));
    return { name: 'Cache', status: 'ok', message: cachePath };
  } catch {
    return {
      name: 'Cache',
      status: 'fail',
      message: `${cachePath} exists but isn't valid JSON — delete it and rerun`,
    };
  }
}

export function runDoctorChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [checkNodeVersion(), checkNativeAddon()];

  let projectRoot: string | undefined;
  try {
    projectRoot = findProjectRoot();
    checks.push({ name: 'Project root', status: 'ok', message: projectRoot });
  } catch (error) {
    checks.push({ name: 'Project root', status: 'fail', message: (error as Error).message });
  }

  checks.push(checkGit(projectRoot));
  checks.push(checkCache(projectRoot));

  return checks;
}
