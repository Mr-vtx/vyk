import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export interface BackupSet {
  timestamp: string;
  dir: string;
}

const BACKUPS_DIR_NAME = "rewrite-backups";

export async function listBackups(projectRoot: string): Promise<BackupSet[]> {
  const backupsRoot = join(projectRoot, ".vysk", BACKUPS_DIR_NAME);
  if (!existsSync(backupsRoot)) return [];

  const entries = await readdir(backupsRoot, { withFileTypes: true });
  const sets = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      timestamp: entry.name,
      dir: join(backupsRoot, entry.name),
    }));

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

export async function planRestore(
  projectRoot: string,
  backup: BackupSet,
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

export async function applyRestore(
  plan: RestorePlanEntry[],
): Promise<RestoreResult> {
  for (const entry of plan) {
    await mkdir(dirname(entry.targetPath), { recursive: true });
    await copyFile(entry.backupPath, entry.targetPath);
  }
  return { filesRestored: plan.length };
}
