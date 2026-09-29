import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export interface BackupSet {
  /** The timestamp directory name, e.g. "2026-09-28T10-15-30-000Z" — also the id you pass to `undo <timestamp>`. */
  timestamp: string;
  dir: string;
}

const BACKUPS_DIR_NAME = 'rewrite-backups';

/**
 * Lists backups written by `vysk rewrite`, newest first. The
 * directory names are ISO timestamps with `:`/`.` replaced by `-` (see
 * `rewrite.ts`'s `applyEditPlans`), so a plain string sort is already
 * chronological — no need to parse them back into Dates.
 */
export async function listBackups(projectRoot: string): Promise<BackupSet[]> {
  const backupsRoot = join(projectRoot, '.vysk', BACKUPS_DIR_NAME);
  if (!existsSync(backupsRoot)) return [];

  const entries = await readdir(backupsRoot, { withFileTypes: true });
  const sets = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ timestamp: entry.name, dir: join(backupsRoot, entry.name) }));

  return sets.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

export interface RestorePlanEntry {
  backupPath: string;
  targetPath: string;
}

/**
 * Files a restore of `backup` would overwrite. `applyEditPlans` mirrors
 * each edited file's project-relative path under the backup's timestamp
 * directory, so that same relative path is exactly where each file
 * belongs back in the project.
 */
export async function planRestore(
  projectRoot: string,
  backup: BackupSet
): Promise<RestorePlanEntry[]> {
  const files = await walkFiles(backup.dir);
  return files.map((backupPath) => ({
    backupPath,
    targetPath: join(projectRoot, relative(backup.dir, backupPath)),
  }));
}

export interface RestoreResult {
  filesRestored: number;
}

export async function applyRestore(plan: RestorePlanEntry[]): Promise<RestoreResult> {
  for (const entry of plan) {
    await mkdir(dirname(entry.targetPath), { recursive: true });
    await copyFile(entry.backupPath, entry.targetPath);
  }
  return { filesRestored: plan.length };
}
