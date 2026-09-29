
export interface OptimizeOptions {
  quality?: number;
  lossless?: boolean;
  dryRun?: boolean;
}

export interface OptimizeResult {
  inputPath: string;
  outputPath: string;
  originalSize: number;
  outputSize: number;
  skipped: boolean;
  reason?: string;
}
