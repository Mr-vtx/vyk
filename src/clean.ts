import { existsSync, statSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  loadConversions,
  findSourceFiles,
  escapeRegExp,
  IMPORT_SPECIFIER_PATTERN,
  type ConversionEntry,
} from "./rewrite";

export interface CleanCandidate {
  absoluteSourcePath: string;
  absoluteOutputPath: string;
  originalSize: number;
}

function fileReferencesConversion(
  content: string,
  filePath: string,
  conversion: ConversionEntry,
): boolean {
  if (conversion.webRootPath) {
    const pattern = new RegExp(
      `${escapeRegExp(conversion.webRootPath)}(?![\\w.-])`,
    );
    if (pattern.test(content)) return true;
  }

  if (/\.(?:tsx|jsx|js)$/.test(filePath)) {
    const fileDir = dirname(filePath);
    for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      if (resolve(fileDir, specifier) === conversion.absoluteSourcePath)
        return true;
    }
  }

  return false;
}

export async function findUnusedOriginals(
  projectRoot: string,
  scanDirs: string[],
): Promise<CleanCandidate[]> {
  const conversions = await loadConversions(projectRoot, scanDirs);
  if (conversions.length === 0) return [];

  const sourceFiles = await findSourceFiles(projectRoot, new Set(scanDirs));
  const fileContents = new Map<string, string>();
  for (const filePath of sourceFiles) {
    try {
      fileContents.set(filePath, await readFile(filePath, "utf8"));
    } catch {}
  }

  const candidates: CleanCandidate[] = [];
  for (const conversion of conversions) {
    if (!existsSync(conversion.absoluteSourcePath)) continue; // already gone

    let referenced = false;
    for (const [filePath, content] of fileContents) {
      if (fileReferencesConversion(content, filePath, conversion)) {
        referenced = true;
        break;
      }
    }

    if (!referenced) {
      candidates.push({
        absoluteSourcePath: conversion.absoluteSourcePath,
        absoluteOutputPath: conversion.absoluteOutputPath,
        originalSize: statSync(conversion.absoluteSourcePath).size,
      });
    }
  }

  return candidates;
}

export interface CleanApplyResult {
  filesRemoved: number;
  bytesFreed: number;
}

export async function applyClean(
  candidates: CleanCandidate[],
): Promise<CleanApplyResult> {
  let bytesFreed = 0;
  for (const candidate of candidates) {
    bytesFreed += candidate.originalSize;
    await unlink(candidate.absoluteSourcePath);
  }
  return { filesRemoved: candidates.length, bytesFreed };
}
