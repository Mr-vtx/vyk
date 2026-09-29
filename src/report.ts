import type { OptimizeResult } from './types';

/**
 * An OptimizeResult, plus whether it came from cache instead of a real
 * encode, and — if the encode/decode itself threw — the error message.
 * `error` entries are always `skipped: true` too, so any code that only
 * checks `skipped` still treats them safely as "nothing was written".
 */
export type CliResult = OptimizeResult & { cached: boolean; error?: string };

export interface ReportOptions {
  dryRun?: boolean;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export const color = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

interface Tally {
  optimizedCount: number;
  cachedCount: number;
  skippedCount: number;
  erroredCount: number;
  bytesSaved: number;
  totalScannedBytes: number;
}

function tally(results: CliResult[]): Tally {
  const t: Tally = {
    optimizedCount: 0,
    cachedCount: 0,
    skippedCount: 0,
    erroredCount: 0,
    bytesSaved: 0,
    totalScannedBytes: 0,
  };

  for (const result of results) {
    t.totalScannedBytes += result.originalSize;

    if (result.error) {
      t.erroredCount += 1;
      continue;
    }
    if (result.cached) {
      t.cachedCount += 1;
      t.bytesSaved += result.originalSize - result.outputSize;
      continue;
    }
    if (result.skipped) {
      t.skippedCount += 1;
      continue;
    }
    t.optimizedCount += 1;
    t.bytesSaved += result.originalSize - result.outputSize;
  }

  return t;
}

export function printReport(results: CliResult[], options: ReportOptions = {}): void {
  const dryRun = options.dryRun ?? false;

  console.log('');
  console.log(
    color.bold('Vysk optimization report') +
      (dryRun ? color.magenta('  (dry run — nothing was written)') : '')
  );
  console.log('');

  for (const result of results) {
    if (result.error) {
      console.log(`${color.red('error')} ${result.inputPath}  ${color.dim(result.error)}`);
      continue;
    }

    if (result.cached) {
      console.log(
        `${color.cyan('cache')} ${result.inputPath}  ${color.dim('unchanged since last run')}`
      );
      continue;
    }

    if (result.skipped) {
      console.log(
        `${color.yellow('skip')}  ${result.inputPath}  ${color.dim(
          result.reason ?? 'not smaller'
        )}`
      );
      continue;
    }

    const saved = result.originalSize - result.outputSize;
    const savedPct = result.originalSize > 0 ? (saved / result.originalSize) * 100 : 0;
    const label = dryRun ? color.magenta('would') : color.green('done');

    console.log(
      `${label}  ${result.inputPath} -> ${result.outputPath}  ` +
        `${formatBytes(result.originalSize)} -> ${formatBytes(result.outputSize)} ` +
        color.green(`(-${savedPct.toFixed(0)}%)`)
    );
  }

  const t = tally(results);

  console.log('');
  const optimizedLabel = dryRun ? 'would optimize' : 'optimized';
  let summaryLine = `${t.optimizedCount} ${optimizedLabel}, ${t.cachedCount} cached, ${t.skippedCount} skipped`;
  if (t.erroredCount > 0) {
    summaryLine += `, ${color.red(`${t.erroredCount} errored`)}`;
  }
  console.log(color.bold(summaryLine));

  if ((t.optimizedCount > 0 || t.cachedCount > 0) && t.totalScannedBytes > 0) {
    const overallPct = (t.bytesSaved / t.totalScannedBytes) * 100;
    const savedLabel = dryRun ? 'Would save' : 'Total saved';
    console.log(
      `${savedLabel}: ${formatBytes(t.bytesSaved)} (${overallPct.toFixed(1)}% of scanned assets)`
    );
  }
  console.log('');
}

/**
 * Same data as `printReport`, as a single JSON object on stdout instead of
 * colored lines — for CI steps or agents that want to parse the result
 * rather than scrape terminal output.
 */
export function printJsonReport(results: CliResult[], options: ReportOptions = {}): void {
  const dryRun = options.dryRun ?? false;
  const t = tally(results);

  console.log(
    JSON.stringify(
      {
        dryRun,
        summary: {
          optimized: t.optimizedCount,
          cached: t.cachedCount,
          skipped: t.skippedCount,
          errored: t.erroredCount,
          bytesSaved: t.bytesSaved,
          totalScannedBytes: t.totalScannedBytes,
        },
        results,
      },
      null,
      2
    )
  );
}
