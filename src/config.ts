import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ImageForgeConfig {
  quality?: number;
  lossless?: boolean;
  /** Directories to scan for images, relative to the project root. Default: ['public']. */
  paths?: string[];
}

/**
 * Loads `imageforge.config.js` from the project root, if present.
 * CommonJS (`module.exports = {...}`), matching the convention of
 * `next.config.js` / `tailwind.config.js` in the projects this tool
 * targets. Returns an empty config (falling back to CLI flags and
 * built-in defaults) if the file doesn't exist or fails to load.
 */
export function loadConfig(projectRoot: string): ImageForgeConfig {
  const configPath = join(projectRoot, 'imageforge.config.js');
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(configPath);
    return (loaded && loaded.default ? loaded.default : loaded) as ImageForgeConfig;
  } catch (error) {
    console.error(
      `Warning: failed to load imageforge.config.js, using defaults instead: ${(error as Error).message}`
    );
    return {};
  }
}
