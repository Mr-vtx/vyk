import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

export interface ConversionEntry {
  absoluteSourcePath: string;
  absoluteOutputPath: string;
  /**
   * Web-root-relative path (e.g. "/images/hero.jpg"), only populated when
   * the source lives under a directory literally named "public" — the
   * Next.js/CRA/Vite convention for "served at the site root". Paths
   * under any other configured scan directory only get matched via
   * import-statement resolution, not this string form.
   */
  webRootPath?: string;
  webRootOutputPath?: string;
}

interface CacheFileEntry {
  outputPath: string;
}

interface CacheFileShape {
  version: number;
  entries: Record<string, CacheFileEntry>;
}

/**
 * Builds the list of known source->output conversions from
 * `.vysk/cache.json` — the cache is already the source of truth for
 * "which files were converted, and to what", so rewriting reuses it
 * instead of re-deriving anything.
 */
export async function loadConversions(
  projectRoot: string,
  scanDirs: string[]
): Promise<ConversionEntry[]> {
  const cachePath = join(projectRoot, '.vysk', 'cache.json');
  if (!existsSync(cachePath)) {
    return [];
  }

  const raw = await readFile(cachePath, 'utf8');
  const parsed = JSON.parse(raw) as CacheFileShape;
  const publicDirs = scanDirs.filter((d) => basename(d) === 'public');

  const conversions: ConversionEntry[] = [];
  for (const [absoluteSourcePath, entry] of Object.entries(parsed.entries ?? {})) {
    const conversion: ConversionEntry = {
      absoluteSourcePath,
      absoluteOutputPath: entry.outputPath,
    };

    for (const publicDir of publicDirs) {
      const prefix = publicDir + sep;
      if (absoluteSourcePath.startsWith(prefix)) {
        conversion.webRootPath = `/${relative(publicDir, absoluteSourcePath).split(sep).join('/')}`;
        conversion.webRootOutputPath = `/${relative(publicDir, entry.outputPath)
          .split(sep)
          .join('/')}`;
        break;
      }
    }

    conversions.push(conversion);
  }

  return conversions;
}

const REWRITE_SCAN_EXTENSIONS = new Set(['.tsx', '.jsx', '.js', '.css', '.scss']);
const REWRITE_SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.next', 'dist', 'build']);

/** Recursively finds .tsx/.jsx/.js/.css/.scss files, skipping build output and asset dirs. */
export async function findSourceFiles(
  projectRoot: string,
  skipAbsoluteDirs: Set<string> = new Set()
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    if (skipAbsoluteDirs.has(current)) return;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (REWRITE_SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && REWRITE_SCAN_EXTENSIONS.has(extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }

  await walk(projectRoot);
  return results;
}

export interface PlannedEdit {
  oldPath: string;
  newPath: string;
  matchCount: number;
}

export interface FileEditPlan {
  filePath: string;
  originalContent: string;
  newContent: string;
  edits: PlannedEdit[];
}

// Exported so `clean.ts` can reuse the exact same reference-matching rules
// when deciding whether an original is safe to delete, instead of
// maintaining a second, potentially-drifting copy of this logic.
export const IMPORT_SPECIFIER_PATTERN =
  /(?:from\s+|require\()\s*['"`]([^'"`]+\.(?:png|jpe?g))['"`]/gi;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Plans the edits for a single source file against the known conversions.
 * Returns null if nothing in this file matches. Two independent passes:
 *
 * 1. Web-root string literals — an exact substring replace of the path
 *    text itself (e.g. "/images/hero.jpg" -> "/images/hero.webp"). This
 *    works uniformly across JSX `src="..."`, CSS `url(...)`, and template
 *    literals without needing separate patterns per syntax, since only
 *    the path text changes, never its surrounding quotes/parens.
 * 2. Local import/require specifiers (`.js`/`.jsx`/`.tsx` only) — resolved
 *    relative to the importing file's directory and compared against the
 *    cache's absolute paths, since these use filesystem-relative paths
 *    like "../../public/images/hero.jpg", not web-root paths.
 *
 * This is text/regex-based, not an AST-aware codemod — dynamic or
 * computed paths (e.g. `src={\`/images/${slug}.jpg\`}`) are not caught.
 * Always review a dry run before writing.
 */
export async function planFileEdits(
  filePath: string,
  conversions: ConversionEntry[]
): Promise<FileEditPlan | null> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  const edits: PlannedEdit[] = [];

  for (const conversion of conversions) {
    if (!conversion.webRootPath || !conversion.webRootOutputPath) continue;

    // Negative lookahead guards against partial-path matches, e.g.
    // matching "/images/hero.jpg" inside "/images/hero.jpg.bak".
    const pattern = new RegExp(`${escapeRegExp(conversion.webRootPath)}(?![\\w.-])`, 'g');
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      content = content.replace(pattern, conversion.webRootOutputPath);
      edits.push({
        oldPath: conversion.webRootPath,
        newPath: conversion.webRootOutputPath,
        matchCount: matches.length,
      });
    }
  }

  if (/\.(?:tsx|jsx|js)$/.test(filePath)) {
    const fileDir = dirname(filePath);
    content = content.replace(IMPORT_SPECIFIER_PATTERN, (fullMatch, specifier: string) => {
      if (!specifier.startsWith('.')) return fullMatch;

      const resolved = resolve(fileDir, specifier);
      const match = conversions.find((c) => c.absoluteSourcePath === resolved);
      if (!match) return fullMatch;

      const newExt = extname(match.absoluteOutputPath);
      const newSpecifier = specifier.replace(/\.(?:png|jpe?g)$/i, newExt);
      edits.push({ oldPath: specifier, newPath: newSpecifier, matchCount: 1 });
      return fullMatch.replace(specifier, newSpecifier);
    });
  }

  if (edits.length === 0) {
    return null;
  }

  return { filePath, originalContent: original, newContent: content, edits };
}

export interface ApplyResult {
  backupDir: string;
  filesChanged: number;
  totalReplacements: number;
}

/**
 * Actually applies a set of previously-planned edits: backs up each
 * file's original content under `.vysk/rewrite-backups/<timestamp>/`
 * (mirroring its path relative to the project root), then writes the new
 * content in place. Pure mechanics — the decision to call this at all
 * (git-clean check, user confirmation) lives in the CLI layer, not here,
 * so this can be tested without any interactive input.
 */
export async function applyEditPlans(
  projectRoot: string,
  plans: FileEditPlan[],
  timestamp: string = new Date().toISOString().replace(/[:.]/g, '-')
): Promise<ApplyResult> {
  const backupDir = join(projectRoot, '.vysk', 'rewrite-backups', timestamp);
  let totalReplacements = 0;

  for (const plan of plans) {
    const relativePath = relative(projectRoot, plan.filePath);
    const backupPath = join(backupDir, relativePath);
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, plan.originalContent);
    await writeFile(plan.filePath, plan.newContent);
    totalReplacements += plan.edits.reduce((sum, edit) => sum + edit.matchCount, 0);
  }

  return { backupDir, filesChanged: plans.length, totalReplacements };
}
