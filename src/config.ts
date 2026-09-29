import { existsSync } from "node:fs";
import { join } from "node:path";

export interface VyskConfig {
  quality?: number;
  lossless?: boolean;
  paths?: string[];
}

export function loadConfig(projectRoot: string): VyskConfig {
  const configPath = join(projectRoot, "vysk.config.js");
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(configPath);
    return (
      loaded && loaded.default ? loaded.default : loaded
    ) as VyskConfig;
  } catch (error) {
    console.error(
      `Warning: failed to load vysk.config.js, using defaults instead: ${(error as Error).message}`,
    );
    return {};
  }
}
