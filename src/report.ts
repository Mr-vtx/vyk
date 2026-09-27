import type { OptimizeResult } from './types';

/** An OptimizeResult, plus whether it came from cache instead of a real encode. */
export type CliResult = OptimizeResult & { cached: boolean };

export interface ReportOptions {
  dryRun?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

const color = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export function printReport(results: CliResult[], options: ReportOptions = {}): void {
  const dryRun = options.dryRun ?? false;

  console.log('');
  console.log(
    color.bold('ImageForge optimization report') +
      (dryRun ? color.magenta('  (dry run — nothing was written)') : '')
  );
  console.log('');

  let optimizedCount = 0;
  let skippedCount = 0;
  let cachedCount = 0;
  let bytesSaved = 0;
  let totalScannedBytes = 0;

  for (const result of results) {
    totalScannedBytes += result.originalSize;

    if (result.cached) {
      cachedCount += 1;
      const saved = result.originalSize - result.outputSize;
      bytesSaved += saved;
      console.log(
        `${color.cyan('cache')} ${result.inputPath}  ${color.dim('unchanged since last run')}`
      );
      continue;
    }

    if (result.skipped) {
      skippedCount += 1;
      console.log(
        `${color.yellow('skip')}  ${result.inputPath}  ${color.dim(
          result.reason ?? 'not smaller'
        )}`
      );
      continue;
    }

    optimizedCount += 1;
    const saved = result.originalSize - result.outputSize;
    bytesSaved += saved;
    const savedPct = result.originalSize > 0 ? (saved / result.originalSize) * 100 : 0;
    const label = dryRun ? color.magenta('would') : color.green('done');

    console.log(
      `${label}  ${result.inputPath} -> ${result.outputPath}  ` +
        `${formatBytes(result.originalSize)} -> ${formatBytes(result.outputSize)} ` +
        color.green(`(-${savedPct.toFixed(0)}%)`)
    );
  }

  console.log('');
  const optimizedLabel = dryRun ? 'would optimize' : 'optimized';
  console.log(
    color.bold(`${optimizedCount} ${optimizedLabel}, ${cachedCount} cached, ${skippedCount} skipped`)
  );

  if ((optimizedCount > 0 || cachedCount > 0) && totalScannedBytes > 0) {
    const overallPct = (bytesSaved / totalScannedBytes) * 100;
    const savedLabel = dryRun ? 'Would save' : 'Total saved';
    console.log(
      `${savedLabel}: ${formatBytes(bytesSaved)} (${overallPct.toFixed(1)}% of scanned assets)`
    );
  }
  console.log('');
}
