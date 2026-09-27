import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkGitStatus } from "./git";

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initTestRepo(root: string): void {
  git(["init"], root);
  git(["config", "user.email", "test@example.com"], root);
  git(["config", "user.name", "Test"], root);
  git(["config", "commit.gpgsign", "false"], root);
}

test("reports not a repo when there is no .git directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "imageforge-git-test-"));
  try {
    const status = checkGitStatus(root);
    assert.equal(status.isRepo, false);
    assert.equal(status.isClean, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports clean for a repo with a committed file and no changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "imageforge-git-test-"));
  try {
    initTestRepo(root);
    await writeFile(join(root, "file.txt"), "hello");
    git(["add", "."], root);
    git(["commit", "-m", "initial"], root);

    const status = checkGitStatus(root);
    assert.equal(status.isRepo, true);
    assert.equal(status.isClean, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports dirty when there are uncommitted changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "imageforge-git-test-"));
  try {
    initTestRepo(root);
    await writeFile(join(root, "file.txt"), "hello");
    git(["add", "."], root);
    git(["commit", "-m", "initial"], root);

    await writeFile(join(root, "file.txt"), "changed");

    const status = checkGitStatus(root);
    assert.equal(status.isRepo, true);
    assert.equal(status.isClean, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports dirty for an untracked file in an otherwise clean repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "imageforge-git-test-"));
  try {
    initTestRepo(root);
    await writeFile(join(root, "file.txt"), "hello");
    git(["add", "."], root);
    git(["commit", "-m", "initial"], root);

    await writeFile(join(root, "untracked.txt"), "new file");

    const status = checkGitStatus(root);
    assert.equal(status.isRepo, true);
    assert.equal(status.isClean, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finds a repo rooted in a parent directory, not just projectRoot itself", async () => {
  const parent = await mkdtemp(join(tmpdir(), "imageforge-git-test-"));
  try {
    initTestRepo(parent);
    await writeFile(join(parent, "root.txt"), "hello");
    git(["add", "."], parent);
    git(["commit", "-m", "root commit"], parent);

    const subproject = join(parent, "subproject");
    await mkdir(subproject);
    await writeFile(join(subproject, "file.txt"), "never committed");
    const status = checkGitStatus(subproject);
    assert.equal(status.isRepo, true);
    assert.equal(status.isClean, false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
