import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyClean, findUnusedOriginals } from './clean';

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vysk-clean-test-'));
}

async function writeCache(root: string, entries: Record<string, { outputPath: string }>): Promise<void> {
  await mkdir(join(root, '.vysk'), { recursive: true });
  await writeFile(
    join(root, '.vysk', 'cache.json'),
    JSON.stringify({ version: 1, entries })
  );
}

test('findUnusedOriginals flags a converted image with no remaining reference', async () => {
  const root = await makeTempProject();
  try {
    const sourcePath = join(root, 'public', 'images', 'hero.jpg');
    const outputPath = join(root, 'public', 'images', 'hero.webp');
    await mkdir(join(root, 'public', 'images'), { recursive: true });
    await writeFile(sourcePath, 'fake-jpg-bytes');
    await writeFile(outputPath, 'fake-webp-bytes');
    await writeCache(root, { [sourcePath]: { outputPath } });

    // Source already rewritten to point at the .webp — no reference to the original left.
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'App.tsx'), '<img src="/images/hero.webp" />');

    const candidates = await findUnusedOriginals(root, [join(root, 'public')]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].absoluteSourcePath, sourcePath);
    assert.equal(candidates[0].originalSize, 'fake-jpg-bytes'.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findUnusedOriginals does NOT flag an image still referenced by its original path', async () => {
  const root = await makeTempProject();
  try {
    const sourcePath = join(root, 'public', 'images', 'hero.jpg');
    const outputPath = join(root, 'public', 'images', 'hero.webp');
    await mkdir(join(root, 'public', 'images'), { recursive: true });
    await writeFile(sourcePath, 'fake-jpg-bytes');
    await writeFile(outputPath, 'fake-webp-bytes');
    await writeCache(root, { [sourcePath]: { outputPath } });

    // Rewrite was never run (or missed it) — still references the original.
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'App.tsx'), '<img src="/images/hero.jpg" />');

    const candidates = await findUnusedOriginals(root, [join(root, 'public')]);
    assert.deepEqual(candidates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findUnusedOriginals does NOT flag an image still referenced via a relative import', async () => {
  const root = await makeTempProject();
  try {
    const sourcePath = join(root, 'static', 'hero.jpg');
    const outputPath = join(root, 'static', 'hero.webp');
    await mkdir(join(root, 'static'), { recursive: true });
    await writeFile(sourcePath, 'fake-jpg-bytes');
    await writeFile(outputPath, 'fake-webp-bytes');
    // Not under a dir named "public", so this only matches via import resolution.
    await writeCache(root, { [sourcePath]: { outputPath } });

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'App.tsx'), "import hero from '../static/hero.jpg';");

    const candidates = await findUnusedOriginals(root, [join(root, 'static')]);
    assert.deepEqual(candidates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findUnusedOriginals skips an original that no longer exists on disk', async () => {
  const root = await makeTempProject();
  try {
    const sourcePath = join(root, 'public', 'images', 'gone.jpg');
    const outputPath = join(root, 'public', 'images', 'gone.webp');
    await mkdir(join(root, 'public', 'images'), { recursive: true });
    // Note: sourcePath is never written to disk.
    await writeCache(root, { [sourcePath]: { outputPath } });

    const candidates = await findUnusedOriginals(root, [join(root, 'public')]);
    assert.deepEqual(candidates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('applyClean deletes the given candidates and reports bytes freed', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'delete-me.jpg');
    await writeFile(filePath, '12345'); // 5 bytes

    const result = await applyClean([
      { absoluteSourcePath: filePath, absoluteOutputPath: `${filePath}.webp`, originalSize: 5 },
    ]);

    assert.equal(result.filesRemoved, 1);
    assert.equal(result.bytesFreed, 5);
    assert.equal(existsSync(filePath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
