import { execFileSync } from "node:child_process";

export interface GitStatus {
  isRepo: boolean;
  isClean: boolean;
}

export function checkGitStatus(projectRoot: string): GitStatus {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { isRepo: true, isClean: output.trim().length === 0 };
  } catch {
    return { isRepo: false, isClean: false };
  }
}
