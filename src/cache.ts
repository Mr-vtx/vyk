import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: TOOL_VERSION } = require("../package.json") as {
  version: string;
};

const CACHE_VERSION = 1;
const CACHE_RELATIVE_PATH = ".vysk/cache.json";

export interface CacheEntry {
  hash: string;
  toolVersion: string;
  quality: number;
  lossless: boolean;
  outputPath: string;
  originalSize: number;
  outputSize: number;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

function emptyCacheFile(): CacheFile {
  return { version: CACHE_VERSION, entries: {} };
}

export class ImageCache {
  private dirty = false;

  private constructor(
    private readonly cachePath: string,
    private data: CacheFile,
  ) {}

  static async load(projectRoot: string): Promise<ImageCache> {
    const cachePath = join(projectRoot, CACHE_RELATIVE_PATH);
    try {
      const raw = await readFile(cachePath, "utf8");
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version === CACHE_VERSION && parsed.entries) {
        return new ImageCache(cachePath, parsed);
      }
    } catch {
      // No cache yet, or it's corrupt/unreadable — start fresh rather than fail the run.
    }
    return new ImageCache(cachePath, emptyCacheFile());
  }

  async hashFile(filePath: string): Promise<string> {
    const contents = await readFile(filePath);
    return createHash("sha256").update(contents).digest("hex");
  }

  get(
    filePath: string,
    hash: string,
    quality: number,
    lossless: boolean,
  ): CacheEntry | undefined {
    const entry = this.data.entries[filePath];
    if (
      entry &&
      entry.hash === hash &&
      entry.toolVersion === TOOL_VERSION &&
      entry.quality === quality &&
      entry.lossless === lossless &&
      existsSync(entry.outputPath)
    ) {
      return entry;
    }
    return undefined;
  }

  set(filePath: string, entry: Omit<CacheEntry, "toolVersion">): void {
    this.data.entries[filePath] = { ...entry, toolVersion: TOOL_VERSION };
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(this.data, null, 2));
  }
}
