import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ImageCache } from './cache';

async function makeTempProject(): Promise<{ root: string; outputPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'imageforge-cache-test-'));
  const outputPath = join(root, 'output.webp');
  await writeFile(outputPath, 'fake-webp-bytes');
  return { root, outputPath };
}

test('cache miss when nothing has been cached yet', async () => {
  const { root, outputPath } = await makeTempProject();
  try {
    const cache = await ImageCache.load(root);
    const hit = cache.get('/some/input.jpg', 'somehash', 82, false);
    assert.equal(hit, undefined);
    void outputPath;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cache hit when hash, settings, and output file all match', async () => {
  const { root, outputPath } = await makeTempProject();
  try {
    const cache = await ImageCache.load(root);
    cache.set('/some/input.jpg', {
      hash: 'abc123',
      quality: 82,
      lossless: false,
      outputPath,
      originalSize: 1000,
      outputSize: 500,
    });

    const hit = cache.get('/some/input.jpg', 'abc123', 82, false);
    assert.ok(hit);
    assert.equal(hit?.outputPath, outputPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cache miss when the file hash changed', async () => {
  const { root, outputPath } = await makeTempProject();
  try {
    const cache = await ImageCache.load(root);
    cache.set('/some/input.jpg', {
      hash: 'abc123',
      quality: 82,
      lossless: false,
      outputPath,
      originalSize: 1000,
      outputSize: 500,
    });

    const hit = cache.get('/some/input.jpg', 'a-different-hash', 82, false);
    assert.equal(hit, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cache miss when quality setting changed', async () => {
  const { root, outputPath } = await makeTempProject();
  try {
    const cache = await ImageCache.load(root);
    cache.set('/some/input.jpg', {
      hash: 'abc123',
      quality: 82,
      lossless: false,
      outputPath,
      originalSize: 1000,
      outputSize: 500,
    });

    const hit = cache.get('/some/input.jpg', 'abc123', 90, false);
    assert.equal(hit, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cache miss when the cached output file no longer exists on disk', async () => {
  const { root, outputPath } = await makeTempProject();
  try {
    const cache = await ImageCache.load(root);
    const missingOutputPath = join(root, 'was-deleted.webp');
    cache.set('/some/input.jpg', {
      hash: 'abc123',
      quality: 82,
      lossless: false,
      outputPath: missingOutputPath,
      originalSize: 1000,
      outputSize: 500,
    });

    const hit = cache.get('/some/input.jpg', 'abc123', 82, false);
    assert.equal(hit, undefined);
    void outputPath;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cache persists to disk and reloads correctly', async () => {
  const { root, outputPath } = await makeTempProject();
  try {
    const cache = await ImageCache.load(root);
    cache.set('/some/input.jpg', {
      hash: 'abc123',
      quality: 82,
      lossless: false,
      outputPath,
      originalSize: 1000,
      outputSize: 500,
    });
    await cache.save();

    const reloaded = await ImageCache.load(root);
    const hit = reloaded.get('/some/input.jpg', 'abc123', 82, false);
    assert.ok(hit);
    assert.equal(hit?.outputSize, 500);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
