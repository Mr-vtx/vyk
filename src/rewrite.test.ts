import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyEditPlans, loadConversions, planFileEdits } from './rewrite';

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'imageforge-rewrite-test-'));
}

async function writeCache(root: string, entries: Record<string, { outputPath: string }>): Promise<void> {
  await mkdir(join(root, '.imageforge'), { recursive: true });
  await writeFile(
    join(root, '.imageforge', 'cache.json'),
    JSON.stringify({ version: 1, entries })
  );
}

test('loadConversions derives web-root paths for files under a "public" scan dir', async () => {
  const root = await makeTempProject();
  try {
    const sourcePath = join(root, 'public', 'images', 'hero.jpg');
    const outputPath = join(root, 'public', 'images', 'hero.webp');
    await writeCache(root, { [sourcePath]: { outputPath } });

    const conversions = await loadConversions(root, [join(root, 'public')]);
    assert.equal(conversions.length, 1);
    assert.equal(conversions[0].webRootPath, '/images/hero.jpg');
    assert.equal(conversions[0].webRootOutputPath, '/images/hero.webp');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadConversions leaves webRootPath unset for a scan dir not named "public"', async () => {
  const root = await makeTempProject();
  try {
    const sourcePath = join(root, 'static', 'images', 'hero.jpg');
    const outputPath = join(root, 'static', 'images', 'hero.webp');
    await writeCache(root, { [sourcePath]: { outputPath } });

    const conversions = await loadConversions(root, [join(root, 'static')]);
    assert.equal(conversions.length, 1);
    assert.equal(conversions[0].webRootPath, undefined);
    assert.equal(conversions[0].absoluteSourcePath, sourcePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadConversions returns an empty list when there is no cache yet', async () => {
  const root = await makeTempProject();
  try {
    const conversions = await loadConversions(root, [join(root, 'public')]);
    assert.deepEqual(conversions, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planFileEdits rewrites a JSX src string to the webp path', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'Hero.tsx');
    await writeFile(
      filePath,
      `export default function Hero() {\n  return <Image src="/images/hero.jpg" alt="Hero" />;\n}\n`
    );

    const plan = await planFileEdits(filePath, [
      {
        absoluteSourcePath: join(root, 'public', 'images', 'hero.jpg'),
        absoluteOutputPath: join(root, 'public', 'images', 'hero.webp'),
        webRootPath: '/images/hero.jpg',
        webRootOutputPath: '/images/hero.webp',
      },
    ]);

    assert.ok(plan);
    assert.match(plan!.newContent, /src="\/images\/hero\.webp"/);
    assert.equal(plan!.edits.length, 1);
    assert.equal(plan!.edits[0].matchCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planFileEdits rewrites a CSS background-image url()', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'styles.css');
    await writeFile(filePath, `.hero {\n  background-image: url(/images/hero.jpg);\n}\n`);

    const plan = await planFileEdits(filePath, [
      {
        absoluteSourcePath: join(root, 'public', 'images', 'hero.jpg'),
        absoluteOutputPath: join(root, 'public', 'images', 'hero.webp'),
        webRootPath: '/images/hero.jpg',
        webRootOutputPath: '/images/hero.webp',
      },
    ]);

    assert.ok(plan);
    assert.match(plan!.newContent, /url\(\/images\/hero\.webp\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planFileEdits does not false-positive-match a longer, unrelated path', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'Hero.tsx');
    // hero.jpg.bak should NOT get corrupted by a rule targeting hero.jpg
    await writeFile(filePath, `const backup = "/images/hero.jpg.bak";\n`);

    const plan = await planFileEdits(filePath, [
      {
        absoluteSourcePath: join(root, 'public', 'images', 'hero.jpg'),
        absoluteOutputPath: join(root, 'public', 'images', 'hero.webp'),
        webRootPath: '/images/hero.jpg',
        webRootOutputPath: '/images/hero.webp',
      },
    ]);

    assert.equal(plan, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planFileEdits resolves and rewrites a relative static import', async () => {
  const root = await makeTempProject();
  try {
    await mkdir(join(root, 'components'), { recursive: true });
    await mkdir(join(root, 'public', 'images'), { recursive: true });
    const filePath = join(root, 'components', 'Hero.tsx');
    await writeFile(
      filePath,
      `import heroImg from '../public/images/hero.jpg';\nexport default heroImg;\n`
    );

    const plan = await planFileEdits(filePath, [
      {
        absoluteSourcePath: join(root, 'public', 'images', 'hero.jpg'),
        absoluteOutputPath: join(root, 'public', 'images', 'hero.webp'),
        webRootPath: '/images/hero.jpg',
        webRootOutputPath: '/images/hero.webp',
      },
    ]);

    assert.ok(plan);
    assert.match(plan!.newContent, /from '\.\.\/public\/images\/hero\.webp'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planFileEdits ignores an import of an unrelated, unconverted image', async () => {
  const root = await makeTempProject();
  try {
    await mkdir(join(root, 'components'), { recursive: true });
    const filePath = join(root, 'components', 'Other.tsx');
    await writeFile(filePath, `import other from '../public/images/other.jpg';\n`);

    const plan = await planFileEdits(filePath, [
      {
        absoluteSourcePath: join(root, 'public', 'images', 'hero.jpg'),
        absoluteOutputPath: join(root, 'public', 'images', 'hero.webp'),
        webRootPath: '/images/hero.jpg',
        webRootOutputPath: '/images/hero.webp',
      },
    ]);

    assert.equal(plan, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planFileEdits returns null for a file with no matching references', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'unrelated.tsx');
    await writeFile(filePath, `export const x = 1;\n`);

    const plan = await planFileEdits(filePath, [
      {
        absoluteSourcePath: join(root, 'public', 'images', 'hero.jpg'),
        absoluteOutputPath: join(root, 'public', 'images', 'hero.webp'),
        webRootPath: '/images/hero.jpg',
        webRootOutputPath: '/images/hero.webp',
      },
    ]);

    assert.equal(plan, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planFileEdits rewrites to .avif when that is what the cache recorded', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'Hero.tsx');
    await writeFile(filePath, `<Image src="/images/huge.jpg" />`);

    const plan = await planFileEdits(filePath, [
      {
        absoluteSourcePath: join(root, 'public', 'images', 'huge.jpg'),
        absoluteOutputPath: join(root, 'public', 'images', 'huge.avif'),
        webRootPath: '/images/huge.jpg',
        webRootOutputPath: '/images/huge.avif',
      },
    ]);

    assert.ok(plan);
    assert.match(plan!.newContent, /src="\/images\/huge\.avif"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('applyEditPlans writes new content and backs up the original', async () => {
  const root = await makeTempProject();
  try {
    const filePath = join(root, 'Hero.tsx');
    const originalContent = `<Image src="/images/hero.jpg" />`;
    const newContent = `<Image src="/images/hero.webp" />`;
    await writeFile(filePath, originalContent);

    const plan = {
      filePath,
      originalContent,
      newContent,
      edits: [{ oldPath: '/images/hero.jpg', newPath: '/images/hero.webp', matchCount: 1 }],
    };

    const result = await applyEditPlans(root, [plan], '2024-01-01T00-00-00');

    assert.equal(result.filesChanged, 1);
    assert.equal(result.totalReplacements, 1);

    const writtenContent = await readFile(filePath, 'utf8');
    assert.equal(writtenContent, newContent);

    const backupPath = join(root, '.imageforge', 'rewrite-backups', '2024-01-01T00-00-00', 'Hero.tsx');
    const backedUpContent = await readFile(backupPath, 'utf8');
    assert.equal(backedUpContent, originalContent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('applyEditPlans preserves directory structure in the backup', async () => {
  const root = await makeTempProject();
  try {
    await mkdir(join(root, 'components', 'nested'), { recursive: true });
    const filePath = join(root, 'components', 'nested', 'Deep.tsx');
    await writeFile(filePath, 'old');

    const plan = {
      filePath,
      originalContent: 'old',
      newContent: 'new',
      edits: [{ oldPath: 'x', newPath: 'y', matchCount: 1 }],
    };

    await applyEditPlans(root, [plan], 'ts1');

    const backupPath = join(root, '.imageforge', 'rewrite-backups', 'ts1', 'components', 'nested', 'Deep.tsx');
    const backedUp = await readFile(backupPath, 'utf8');
    assert.equal(backedUp, 'old');

    const written = await readFile(filePath, 'utf8');
    assert.equal(written, 'new');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
