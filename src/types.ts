/**
 * Mirrors the `#[napi(object)]` structs in `src/lib.rs`. napi-rs converts
 * Rust's snake_case field names to camelCase for JS/TS, which is what's
 * reflected here. These are hand-declared (rather than imported from the
 * generated `index.d.ts`) so the TypeScript layer type-checks even before
 * the native addon has been built.
 */

export interface OptimizeOptions {
  /** WebP quality, 0-100. Ignored when `lossless` is true. Default: 82. */
  quality?: number;
  /** Force lossless WebP encoding. */
  lossless?: boolean;
  /** Run the full pipeline but never write the output file. */
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
