#!/usr/bin/env node
import { relative, resolve } from 'node:path';
import { findImages, findProjectRoot } from './scanner';
import { optimizeImage } from './native';
import { printReport, type CliResult } from './report';
import { loadConfig } from './config';
import { ImageCache } from './cache';
import { checkGitStatus } from './git';
import { ensureGitignored } from './gitignore';
import {
  loadConversions,
  findSourceFiles,
  planFileEdits,
  applyEditPlans,
  type FileEditPlan,
} from './rewrite';
import { confirm } from './prompt';

function resolveScanDirs(projectRoot: string, paths: string[] | undefined): string[] {
  const configured = paths && paths.length > 0 ? paths : ['public'];
  return configured.map((p) => resolve(projectRoot, p));
}

// ---------------------------------------------------------------------------
// `imageforge -c` — optimize images (Phase 1/2)
// ---------------------------------------------------------------------------

interface CompressOptions {
  quality?: number;
  lossless?: boolean;
  useCache: boolean;
  dryRun: boolean;
}

function parseCompressArgs(argv: string[]): CompressOptions {
  const options: CompressOptions = { useCache: true, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-q' || arg === '--quality') {
      const value = Number(argv[i + 1]);
      if (!Number.isNaN(value)) options.quality = value;
      i += 1;
    } else if (arg === '--lossless') {
      options.lossless = true;
    } else if (arg === '--no-cache') {
      options.useCache = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function printCompressHelp(): void {
  console.log(`
ImageForge - optimize website images to WebP (falls back to AVIF for
oversized images)

Usage:
  npx imageforge -c [options]
  npx imageforge rewrite [options]   (see: imageforge rewrite --help)

Options:
  -c, --compress     Scan configured paths and optimize images
  -q, --quality <n>  Encode quality, 0-100 (default: 82, or imageforge.config.js)
  --lossless         Force lossless WebP encoding
  --no-cache         Ignore the cache and reprocess every image
  --dry-run          Show what would happen without writing any files
  -h, --help         Show this help message

Config:
  imageforge.config.js in the project root can set defaults for
  "quality", "lossless", and "paths" (CLI flags override it).

Caching:
  Results are cached in .imageforge/cache.json (gitignored). An image
  is only reprocessed if its content, the quality/lossless settings,
  or the imageforge version have changed since the last run.
`);
}

async function runCompress(argv: string[]): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    printCompressHelp();
    return;
  }

  if (!argv.includes('-c') && !argv.includes('--compress')) {
    printCompressHelp();
    process.exitCode = 1;
    return;
  }

  const cliOptions = parseCompressArgs(argv);

  let projectRoot: string;
  try {
    projectRoot = findProjectRoot();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(projectRoot);
  const gitignoreResult = await ensureGitignored(projectRoot);
  if (gitignoreResult !== 'already-present') {
    console.log(`(${gitignoreResult} .gitignore entry for .imageforge/)`);
  }
  const quality = cliOptions.quality ?? config.quality ?? 82;
  const lossless = cliOptions.lossless ?? config.lossless ?? false;
  const scanDirs = resolveScanDirs(projectRoot, config.paths);

  const imageSet = new Set<string>();
  for (const dir of scanDirs) {
    for (const imagePath of await findImages(dir)) {
      imageSet.add(imagePath);
    }
  }
  const images = [...imageSet];

  if (images.length === 0) {
    console.log(`No PNG/JPG/JPEG images found under: ${scanDirs.join(', ')}`);
    return;
  }

  const cache = await ImageCache.load(projectRoot);
  const results: CliResult[] = [];

  for (const imagePath of images) {
    const hash = await cache.hashFile(imagePath);
    const cached = cliOptions.useCache ? cache.get(imagePath, hash, quality, lossless) : undefined;

    if (cached) {
      results.push({
        inputPath: imagePath,
        outputPath: cached.outputPath,
        originalSize: cached.originalSize,
        outputSize: cached.outputSize,
        skipped: false,
        cached: true,
      });
      continue;
    }

    try {
      const result = optimizeImage(imagePath, { quality, lossless, dryRun: cliOptions.dryRun });
      results.push({ ...result, cached: false });

      if (!result.skipped && !cliOptions.dryRun) {
        cache.set(imagePath, {
          hash,
          quality,
          lossless,
          outputPath: result.outputPath,
          originalSize: result.originalSize,
          outputSize: result.outputSize,
        });
      }
    } catch (error) {
      console.error(`Failed to optimize ${imagePath}: ${(error as Error).message}`);
    }
  }

  if (!cliOptions.dryRun) {
    await cache.save();
  }
  printReport(results, { dryRun: cliOptions.dryRun });
}

// ---------------------------------------------------------------------------
// `imageforge rewrite` — Phase 3: rewrite source references to point at the
// optimized outputs. The only imageforge command that touches your actual
// source code. Always shows the full plan and asks for explicit
// confirmation before writing anything.
// ---------------------------------------------------------------------------

function printRewriteHelp(): void {
  console.log(`
ImageForge rewrite - update source references to point at optimized images

Usage:
  npx imageforge rewrite [options]

What it does:
  Reads .imageforge/cache.json (built by "imageforge -c") to find every
  image that's already been optimized, scans .tsx/.jsx/.js/.css/.scss for
  references to those original files, and rewrites them to point at the
  .webp/.avif output instead. Always shows the full plan and asks for
  y/N confirmation before writing anything.

Options:
  --force   Proceed even if the git working tree isn't clean (or isn't a
            git repo at all). Not recommended — this is your rollback
            path if a rewrite goes wrong.
  -h, --help   Show this help message

Safety:
  - Refuses to run on an unclean git tree unless --force is passed.
  - Always prints the full plan before asking to apply it.
  - Backs up every touched file to .imageforge/rewrite-backups/<timestamp>/
    before writing, in addition to whatever git already gives you.
`);
}

async function runRewrite(argv: string[]): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    printRewriteHelp();
    return;
  }

  const force = argv.includes('--force');

  let projectRoot: string;
  try {
    projectRoot = findProjectRoot();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const gitStatus = checkGitStatus(projectRoot);
  if (!gitStatus.isClean && !force) {
    if (!gitStatus.isRepo) {
      console.error(
        "Refusing to run: this project isn't a git repository (or git isn't available), " +
          'so there is no safe rollback point. Re-run with --force to proceed anyway (not recommended).'
      );
    } else {
      console.error(
        'Refusing to run: you have uncommitted changes. Commit or stash them first, ' +
          'or re-run with --force to proceed anyway (not recommended).'
      );
    }
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(projectRoot);
  const gitignoreResult = await ensureGitignored(projectRoot);
  if (gitignoreResult !== 'already-present') {
    console.log(`(${gitignoreResult} .gitignore entry for .imageforge/)`);
  }
  const scanDirs = resolveScanDirs(projectRoot, config.paths);

  const conversions = await loadConversions(projectRoot, scanDirs);
  if (conversions.length === 0) {
    console.log('No conversions recorded yet — run `imageforge -c` first.');
    return;
  }

  const sourceFiles = await findSourceFiles(projectRoot, new Set(scanDirs));
  const plans: FileEditPlan[] = [];
  for (const filePath of sourceFiles) {
    const plan = await planFileEdits(filePath, conversions);
    if (plan) plans.push(plan);
  }

  if (plans.length === 0) {
    console.log('No matching references found in scanned source files.');
    return;
  }

  console.log('');
  console.log('The following changes would be made:');
  console.log('');
  let totalReplacements = 0;
  for (const plan of plans) {
    console.log(relative(projectRoot, plan.filePath));
    for (const edit of plan.edits) {
      totalReplacements += edit.matchCount;
      console.log(`  ${edit.oldPath} -> ${edit.newPath}  (${edit.matchCount}x)`);
    }
  }
  console.log('');
  console.log(`${totalReplacements} replacement(s) across ${plans.length} file(s).`);
  console.log('');

  const proceed = await confirm(`Apply these changes to ${plans.length} file(s)?`);
  if (!proceed) {
    console.log('No changes made.');
    return;
  }

  const result = await applyEditPlans(projectRoot, plans);

  console.log('');
  console.log(`Applied ${result.totalReplacements} replacement(s) across ${result.filesChanged} file(s).`);
  console.log(`Backup of the originals saved to: ${result.backupDir}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === 'rewrite') {
    await runRewrite(argv.slice(1));
    return;
  }

  await runCompress(argv);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
