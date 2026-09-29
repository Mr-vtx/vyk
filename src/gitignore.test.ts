import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureGitignored } from './gitignore';

test('creates .gitignore with the entry when none exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vysk-gitignore-test-'));
  try {
    const result = await ensureGitignored(root);
    assert.equal(result, 'created');

    const content = await readFile(join(root, '.gitignore'), 'utf8');
    assert.match(content, /^\.vysk\/$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('appends the entry to an existing .gitignore that lacks it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vysk-gitignore-test-'));
  try {
    await writeFile(join(root, '.gitignore'), 'node_modules/\n.next/\n');

    const result = await ensureGitignored(root);
    assert.equal(result, 'updated');

    const content = await readFile(join(root, '.gitignore'), 'utf8');
    assert.match(content, /node_modules\//);
    assert.match(content, /\.next\//);
    assert.match(content, /^\.vysk\/$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not duplicate the entry if already present', async () => {
  const root = await makeProjectWithGitignore('node_modules/\n.vysk/\n');
  try {
    const result = await ensureGitignored(root);
    assert.equal(result, 'already-present');

    const content = await readFile(join(root, '.gitignore'), 'utf8');
    const occurrences = content.split('.vysk').length - 1;
    assert.equal(occurrences, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recognizes .vysk without a trailing slash as already covered', async () => {
  const root = await makeProjectWithGitignore('.vysk\n');
  try {
    const result = await ensureGitignored(root);
    assert.equal(result, 'already-present');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handles a .gitignore with no trailing newline without corrupting the last line', async () => {
  const root = await makeProjectWithGitignore('node_modules/');
  try {
    await ensureGitignored(root);
    const content = await readFile(join(root, '.gitignore'), 'utf8');
    assert.match(content, /^node_modules\/$/m);
    assert.match(content, /^\.vysk\/$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeProjectWithGitignore(gitignoreContent: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vysk-gitignore-test-'));
  await writeFile(join(root, '.gitignore'), gitignoreContent);
  return root;
}
