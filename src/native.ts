import type { OptimizeOptions, OptimizeResult } from "./types";

interface NativeBinding {
  optimizeImage(inputPath: string, options?: OptimizeOptions): OptimizeResult;
}

let cached: NativeBinding | undefined;

function loadNative(): NativeBinding {
  if (!cached) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cached = require("../index.js") as NativeBinding;
    } catch (error) {
      throw new Error(
        "Vysk's native addon isn't built yet. Run `npm run build:native` " +
          `(or \`npm run build\`) first.\nOriginal error: ${(error as Error).message}`,
      );
    }
  }
  return cached;
}

export function optimizeImage(
  inputPath: string,
  options?: OptimizeOptions,
): OptimizeResult {
  return loadNative().optimizeImage(inputPath, options);
}

export function checkNativeBinding(): { ok: boolean; message: string } {
  try {
    loadNative();
    return { ok: true, message: "native addon loaded successfully" };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
