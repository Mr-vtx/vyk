export { optimizeImage } from './native';
export { findImages, findProjectRoot } from './scanner';
export { printReport, type CliResult, type ReportOptions } from './report';
export { loadConfig, type ImageForgeConfig } from './config';
export { ImageCache, type CacheEntry } from './cache';
export { checkGitStatus, type GitStatus } from './git';
export {
  loadConversions,
  findSourceFiles,
  planFileEdits,
  type ConversionEntry,
  type PlannedEdit,
  type FileEditPlan,
} from './rewrite';
export { confirm } from './prompt';
export type { OptimizeOptions, OptimizeResult } from './types';
