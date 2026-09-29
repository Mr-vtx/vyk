import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyRestore, listBackups, planRestore } from './undo';
import { applyEditPlans, type FileEditPlan } from './rewrite';

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vysk-undo-test-'));
}

test('listBackups returns an empty list when no backups exist yet', async () => {
  const root = await makeTempProject();
  try {
    const backups = await listBackups(root);
    assert.deepEqual(backups, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('listBackups sorts timestamp directories newest first', async () => {
  const root = await makeTempProject();
  try {
    const backupsRoot = join(root, '.vysk', 'rewrite-backups');
    await mkdir(join(backupsRoot, '2026-01-01T00-00-00-000Z'), { recursive: true });
    await mkdir(join(backupsRoot, '2026-06-15T12-30-00-000Z'), { recursive: true });
    await mkdir(join(backupsRoot, '2026-03-10T08-00-00-000Z'), { recursive: true });

    const backups = await listBackups(root);
    assert.deepEqual(
      backups.map((b) => b.timestamp),
      ['2026-06-15T12-30-00-000Z', '2026-03-10T08-00-00-000Z', '2026-01-01T00-00-00-000Z']
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planRestore + applyRestore round-trips a real rewrite backup back to the original content', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'src', 'App.tsx');
    await mkdir(join(root, 'src'), { recursive: true });
    const originalContent = '<img src="/images/hero.jpg" />';
    await writeFile(filePath, originalContent);

    const plan: FileEditPlan = {
      filePath,
      originalContent,
      newContent: '<img src="/images/hero.webp" />',
      edits: [{ oldPath: '/images/hero.jpg', newPath: '/images/hero.webp', matchCount: 1 }],
    };

    // Simulate a real `rewrite` run: writes the backup, then overwrites the file.
    const applyResult = await applyEditPlans(root, [plan], '2026-09-28T10-00-00-000Z');
    assert.equal(await readFile(filePath, 'utf8'), plan.newContent);

    const backups = await listBackups(root);
    assert.equal(backups.length, 1);
    assert.equal(backups[0].timestamp, '2026-09-28T10-00-00-000Z');
    assert.equal(backups[0].dir, applyResult.backupDir);

    const restorePlan = await planRestore(root, backups[0]);
    assert.equal(restorePlan.length, 1);
    assert.equal(restorePlan[0].targetPath, filePath);

    const restoreResult = await applyRestore(restorePlan);
    assert.equal(restoreResult.filesRestored, 1);
    assert.equal(await readFile(filePath, 'utf8'), originalContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planRestore mirrors nested paths correctly', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'src', 'components', 'Hero.tsx');
    await mkdir(join(root, 'src', 'components'), { recursive: true });
    await writeFile(filePath, 'original');

    const plan: FileEditPlan = {
      filePath,
      originalContent: 'original',
      newContent: 'rewritten',
      edits: [],
    };
    await applyEditPlans(root, [plan], 'ts1');

    const backups = await listBackups(root);
    const restorePlan = await planRestore(root, backups[0]);
    assert.equal(restorePlan[0].targetPath, filePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
