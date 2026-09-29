import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const SKIP_DIR_NAMES = new Set(["node_modules"]);

export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not find a package.json in this directory or any parent directory.",
      );
    }
    dir = parent;
  }
}

export async function findImages(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())
      ) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}
