import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const IGNORE_ENTRY = ".vysk/";
const KNOWN_FORMS = new Set([
  ".vysk/",
  ".vysk",
  "/.vysk/",
  "/.vysk",
]);

export type GitignoreResult = "created" | "updated" | "already-present";

export async function ensureGitignored(
  projectRoot: string,
): Promise<GitignoreResult> {
  const gitignorePath = join(projectRoot, ".gitignore");

  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, `${IGNORE_ENTRY}\n`);
    return "created";
  }

  const content = await readFile(gitignorePath, "utf8");
  const alreadyPresent = content
    .split("\n")
    .some((line) => KNOWN_FORMS.has(line.trim()));

  if (alreadyPresent) {
    return "already-present";
  }

  const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
  await appendFile(
    gitignorePath,
    `${needsLeadingNewline ? "\n" : ""}${IGNORE_ENTRY}\n`,
  );
  return "updated";
}
