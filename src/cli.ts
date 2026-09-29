#!/usr/bin/env node
import { relative, resolve } from 'node:path';
import { findImages, findProjectRoot } from './scanner';
import { optimizeImage } from './native';
import { printReport, printJsonReport, formatBytes, color, type CliResult } from './report';
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
import { findUnusedOriginals, applyClean } from './clean';
import { listBackups, planRestore, applyRestore } from './undo';
import { runDoctorChecks } from './doctor';
import { confirm } from './prompt';

function resolveScanDirs(projectRoot: string, paths: string[] | undefined): string[] {
  const configured = paths && paths.length > 0 ? paths : ['public'];
  return configured.map((p) => resolve(projectRoot, p));
}

/**
 * Shared by `rewrite`, `clean`, and `undo` — every command that touches
 * source files (or deletes originals) refuses to run on a dirty or
 * missing git tree unless `--force` is passed. Prints the reason and sets
 * a failing exit code when it refuses.
 */
function requireCleanGitTree(projectRoot: string, force: boolean): boolean {
  const gitStatus = checkGitStatus(projectRoot);
  if (gitStatus.isClean || force) return true;

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
  return false;
}

// ---------------------------------------------------------------------------
// `vysk -c` — optimize images (Phase 1/2)
// ---------------------------------------------------------------------------

interface CompressOptions {
  quality?: number;
  lossless?: boolean;
  useCache: boolean;
  dryRun: boolean;
  json: boolean;
}

function parseCompressArgs(argv: string[]): CompressOptions {
  const options: CompressOptions = { useCache: true, dryRun: false, json: false };

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
    } else if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

function printCompressHelp(): void {
  console.log(`
Vysk - optimize website images to WebP (falls back to AVIF for
oversized images)

Usage:
  npx vysk -c [options]
  npx vysk rewrite [options]   (see: vysk rewrite --help)
  npx vysk clean [options]     (see: vysk clean --help)
  npx vysk undo [options]      (see: vysk undo --help)
  npx vysk doctor              Check your environment is set up correctly

Options:
  -c, --compress     Scan configured paths and optimize images
  -q, --quality <n>  Encode quality, 0-100 (default: 82, or vysk.config.js)
  --lossless         Force lossless WebP encoding
  --no-cache         Ignore the cache and reprocess every image
  --dry-run          Show what would happen without writing any files
  --json             Print the report as JSON instead of colored text
  -h, --help         Show this help message

Config:
  vysk.config.js in the project root can set defaults for
  "quality", "lossless", and "paths" (CLI flags override it).

Caching:
  Results are cached in .vysk/cache.json (gitignored). An image
  is only reprocessed if its content, the quality/lossless settings,
  or the vysk version have changed since the last run.
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
  if (gitignoreResult !== 'already-present' && !cliOptions.json) {
    console.log(`(${gitignoreResult} .gitignore entry for .vysk/)`);
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
    if (cliOptions.json) {
      printJsonReport([], { dryRun: cliOptions.dryRun });
    } else {
      console.log(`No PNG/JPG/JPEG images found under: ${scanDirs.join(', ')}`);
    }
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
      const message = (error as Error).message;
      if (!cliOptions.json) {
        console.error(`Failed to optimize ${imagePath}: ${message}`);
      }
      results.push({
        inputPath: imagePath,
        outputPath: '',
        originalSize: 0,
        outputSize: 0,
        skipped: true,
        reason: 'error',
        cached: false,
        error: message,
      });
    }
  }

  if (!cliOptions.dryRun) {
    await cache.save();
  }

  if (cliOptions.json) {
    printJsonReport(results, { dryRun: cliOptions.dryRun });
  } else {
    printReport(results, { dryRun: cliOptions.dryRun });
  }

  if (results.some((r) => r.error)) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// `vysk rewrite` — Phase 3: rewrite source references to point at the
// optimized outputs. The only vysk command that touches your actual
// source code. Always shows the full plan and asks for explicit
// confirmation before writing anything.
// ---------------------------------------------------------------------------

function printRewriteHelp(): void {
  console.log(`
Vysk rewrite - update source references to point at optimized images

Usage:
  npx vysk rewrite [options]

What it does:
  Reads .vysk/cache.json (built by "vysk -c") to find every
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
  - Backs up every touched file to .vysk/rewrite-backups/<timestamp>/
    before writing, in addition to whatever git already gives you.
  - If a rewrite goes wrong anyway, "vysk undo" restores from that
    same backup.
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

  if (!requireCleanGitTree(projectRoot, force)) return;

  const config = loadConfig(projectRoot);
  const gitignoreResult = await ensureGitignored(projectRoot);
  if (gitignoreResult !== 'already-present') {
    console.log(`(${gitignoreResult} .gitignore entry for .vysk/)`);
  }
  const scanDirs = resolveScanDirs(projectRoot, config.paths);

  const conversions = await loadConversions(projectRoot, scanDirs);
  if (conversions.length === 0) {
    console.log('No conversions recorded yet — run `vysk -c` first.');
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
// `vysk clean` — Phase 3: remove originals that are no longer
// referenced after a rewrite. Reuses rewrite.ts's exact matching rules so
// the two commands can't disagree about what "referenced" means.
// ---------------------------------------------------------------------------

function printCleanHelp(): void {
  console.log(`
Vysk clean - remove original images no longer referenced after a rewrite

Usage:
  npx vysk clean [options]

What it does:
  Finds images with a recorded .webp/.avif conversion (from
  .vysk/cache.json) that no longer appear to be referenced by any
  scanned source file, shows the full list with sizes, and asks for
  confirmation before deleting the originals.

  Uses the exact same text-matching rules as "vysk rewrite" — a
  computed/dynamic path (e.g. \`/images/\${slug}.jpg\`) won't be caught,
  so "not referenced" here is evidence, not proof. Review the printed
  list before confirming.

Options:
  --force     Proceed even if the git working tree isn't clean. Not
              recommended — git is your rollback path here.
  --dry-run   Show what would be removed without deleting anything
  -h, --help  Show this help message

Safety:
  - Refuses to run on an unclean git tree unless --force is passed.
  - Always prints the full plan (files + sizes) before asking to apply it.
`);
}

async function runClean(argv: string[]): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    printCleanHelp();
    return;
  }

  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');

  let projectRoot: string;
  try {
    projectRoot = findProjectRoot();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  if (!requireCleanGitTree(projectRoot, force)) return;

  const config = loadConfig(projectRoot);
  const scanDirs = resolveScanDirs(projectRoot, config.paths);

  const candidates = await findUnusedOriginals(projectRoot, scanDirs);
  if (candidates.length === 0) {
    console.log('No unused originals found.');
    return;
  }

  console.log('');
  console.log('These originals look unused (no reference found in scanned source):');
  console.log('');
  let totalBytes = 0;
  for (const candidate of candidates) {
    totalBytes += candidate.originalSize;
    console.log(
      `  ${relative(projectRoot, candidate.absoluteSourcePath)}  ${color.dim(
        `(${formatBytes(candidate.originalSize)})`
      )}`
    );
  }
  console.log('');
  console.log(`${candidates.length} file(s), ${formatBytes(totalBytes)} total.`);
  console.log('');
  console.log(
    color.dim(
      "Reminder: text-based reference matching, same as 'vysk rewrite' — a " +
        "dynamic/computed path won't be caught. Review the list above before confirming."
    )
  );
  console.log('');

  if (dryRun) {
    console.log(color.magenta('(dry run — nothing was deleted)'));
    return;
  }

  const proceed = await confirm(`Delete these ${candidates.length} file(s)?`);
  if (!proceed) {
    console.log('No changes made.');
    return;
  }

  const result = await applyClean(candidates);
  console.log('');
  console.log(`Removed ${result.filesRemoved} file(s), freed ${formatBytes(result.bytesFreed)}.`);
}

// ---------------------------------------------------------------------------
// `vysk undo` — restore source files from an `vysk rewrite`
// backup. The mirror image of `rewrite`: same git-clean requirement, same
// "show the plan, ask for confirmation" shape.
// ---------------------------------------------------------------------------

function printUndoHelp(): void {
  console.log(`
Vysk undo - restore source files from an "vysk rewrite" backup

Usage:
  npx vysk undo [timestamp] [options]

  With no timestamp, restores the most recent backup under
  .vysk/rewrite-backups/.

Options:
  --list      List available backups (newest first) instead of restoring
  --force     Proceed even if the git working tree isn't clean
  -h, --help  Show this help message
`);
}

async function runUndo(argv: string[]): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    printUndoHelp();
    return;
  }

  let projectRoot: string;
  try {
    projectRoot = findProjectRoot();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const backups = await listBackups(projectRoot);

  if (argv.includes('--list')) {
    if (backups.length === 0) {
      console.log('No rewrite backups found.');
      return;
    }
    console.log('Available backups (newest first):');
    for (const backup of backups) console.log(`  ${backup.timestamp}`);
    return;
  }

  if (backups.length === 0) {
    console.log('No rewrite backups found — nothing to undo.');
    return;
  }

  const force = argv.includes('--force');
  const requestedTimestamp = argv.find((a) => !a.startsWith('-'));
  const target = requestedTimestamp
    ? backups.find((b) => b.timestamp === requestedTimestamp)
    : backups[0];

  if (!target) {
    console.error(
      `No backup found matching "${requestedTimestamp}". Run \`vysk undo --list\` to see available backups.`
    );
    process.exitCode = 1;
    return;
  }

  if (!requireCleanGitTree(projectRoot, force)) return;

  const plan = await planRestore(projectRoot, target);
  if (plan.length === 0) {
    console.log('That backup is empty — nothing to restore.');
    return;
  }

  console.log('');
  console.log(`Restoring backup from ${target.timestamp}:`);
  for (const entry of plan) {
    console.log(`  ${relative(projectRoot, entry.targetPath)}`);
  }
  console.log('');

  const proceed = await confirm(`Overwrite ${plan.length} file(s) with this backup?`);
  if (!proceed) {
    console.log('No changes made.');
    return;
  }

  const result = await applyRestore(plan);
  console.log('');
  console.log(`Restored ${result.filesRestored} file(s) from ${target.timestamp}.`);
}

// ---------------------------------------------------------------------------
// `vysk doctor` — environment diagnostics. No writes, no confirmation
// needed — safe to run any time, especially right after install.
// ---------------------------------------------------------------------------

function printDoctorHelp(): void {
  console.log(`
Vysk doctor - check that your environment is set up correctly

Usage:
  npx vysk doctor

Checks:
  - Node.js version (18+ required)
  - Native addon loads for this platform
  - Project root can be found (nearest package.json)
  - Git status (repo? clean?)
  - .vysk/cache.json is valid, if present
`);
}

async function runDoctor(argv: string[]): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    printDoctorHelp();
    return;
  }

  const checks = runDoctorChecks();

  console.log('');
  console.log(color.bold('Vysk doctor'));
  console.log('');

  let hasFail = false;
  for (const check of checks) {
    const icon =
      check.status === 'ok' ? color.green('✓') : check.status === 'warn' ? color.yellow('!') : color.red('✗');
    console.log(`${icon} ${check.name}: ${check.message}`);
    if (check.status === 'fail') hasFail = true;
  }
  console.log('');

  if (hasFail) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [sub, ...rest] = argv;

  if (sub === 'rewrite') {
    await runRewrite(rest);
    return;
  }
  if (sub === 'clean') {
    await runClean(rest);
    return;
  }
  if (sub === 'undo') {
    await runUndo(rest);
    return;
  }
  if (sub === 'doctor') {
    await runDoctor(rest);
    return;
  }

  await runCompress(argv);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
