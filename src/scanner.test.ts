import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findImages, findProjectRoot } from './scanner';

async function makeTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'imageforge-test-'));
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}');
  await mkdir(join(root, 'public', 'nested'), { recursive: true });
  await mkdir(join(root, 'public', 'node_modules'), { recursive: true });

  await writeFile(join(root, 'public', 'hero.png'), 'fake-png');
  await writeFile(join(root, 'public', 'banner.JPG'), 'fake-jpg');
  await writeFile(join(root, 'public', 'notes.txt'), 'not an image');
  await writeFile(join(root, 'public', 'nested', 'logo.jpeg'), 'fake-jpeg');
  await writeFile(join(root, 'public', 'node_modules', 'ignored.png'), 'should be skipped');

  return root;
}

test('findProjectRoot finds the nearest package.json', async () => {
  const root = await makeTempProject();
  try {
    const nestedDir = join(root, 'public', 'nested');
    assert.equal(findProjectRoot(nestedDir), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findImages finds png/jpg/jpeg recursively, skips node_modules and other files', async () => {
  const root = await makeTempProject();
  try {
    const images = await findImages(join(root, 'public'));
    const relative = images.map((p) => p.replace(root, '')).sort();

    assert.equal(images.length, 3);
    assert.ok(relative.some((p) => p.endsWith('hero.png')));
    assert.ok(relative.some((p) => p.endsWith('banner.JPG')));
    assert.ok(relative.some((p) => p.endsWith('nested/logo.jpeg') || p.endsWith('nested\\logo.jpeg')));
    assert.ok(!relative.some((p) => p.includes('node_modules')));
    assert.ok(!relative.some((p) => p.endsWith('notes.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findImages returns an empty array for a directory that does not exist', async () => {
  const images = await findImages(join(tmpdir(), 'imageforge-does-not-exist-xyz'));
  assert.deepEqual(images, []);
});
