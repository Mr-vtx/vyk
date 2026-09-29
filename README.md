# Vysk

Optimize website images so pages load faster and use less bandwidth.
Scans a project for PNG/JPG/JPEG and converts them to WebP — smaller,
same quality, original files untouched.

```bash
npm install -D vysk
npx vysk -c
```

```
public/
├── hero.png       2.4 MB
├── logo.png       180 KB
└── banner.jpg     1.8 MB
```

becomes:

```
public/
├── hero.png
├── hero.webp
├── logo.png
├── logo.webp
├── banner.jpg
└── banner.webp
```

No Rust required to install — the heavy lifting happens in a native
addon shipped as a prebuilt binary (via [napi-rs](https://napi.rs)),
the same distribution model `sharp` and `esbuild` use.

## How it works

- **Node/TypeScript** (`src/scanner.ts`, `cli.ts`, `report.ts`) — finds
  the project root, walks `public/` for supported images, drives the
  optimization loop, prints the report.
- **Rust** (`src/lib.rs`) — decodes the image, encodes it to WebP by
  default, or to AVIF if the image exceeds WebP's 16,383px-per-side limit
  (via the pure-Rust [`ravif`](https://docs.rs/ravif) encoder). Connected
  to Node via [napi-rs](https://napi.rs).

Images are always encoded through their RGBA representation, so alpha
transparency survives regardless of source format.

## Development

Requires Node.js 18+, a Rust toolchain (`rustup` recommended), and
`nasm` (required to build `rav1e`, the AVIF encoder — install via
`apt install nasm` / `brew install nasm` / see
[ilammy/setup-nasm](https://github.com/ilammy/setup-nasm) for CI) for
building the native addon — end users of the published package don't
need any of this.

```bash
npm install
npm run build        # builds the native addon, then compiles TypeScript
npm run typecheck     # tsc --noEmit
npm run test:unit     # runs the scanner tests (pure TS, no Rust needed)
```

Try it on a real project:

```bash
cd /path/to/some/project
node /path/to/vysk/dist/cli.js -c
```

### CLI options

| Flag | Description | Default |
| --- | --- | --- |
| `-c`, `--compress` | Scan configured paths and optimize | — |
| `-q`, `--quality <n>` | Encode quality, 0-100 (WebP, or AVIF for oversized images) | `82` |
| `--lossless` | Force lossless WebP encoding | `false` |
| `--no-cache` | Ignore the cache and reprocess every image | — |
| `--dry-run` | Show what would happen — no files written, cache untouched | — |
| `--json` | Print the report as JSON instead of colored text (CI/scripting) | — |
| `-h`, `--help` | Show help | — |

### Config file

`vysk.config.js` in the project root (CommonJS, same convention
as `next.config.js`/`tailwind.config.js`):

```js
module.exports = {
  quality: 75,
  lossless: false,
  paths: ['public', 'static'], // default: ['public']
};
```

Precedence: CLI flag > config file > built-in default. A missing or
broken config file logs a warning and falls back to defaults rather
than failing the run.

### Caching

Results are cached in `.vysk/cache.json` (already gitignored).
An image is only reprocessed if any of these changed since the last
run: the file's content, the `quality`/`lossless` settings, or the
installed vysk version. If the cached output file has been
deleted, it's treated as a miss and reprocessed. Use `--no-cache` to
bypass the cache entirely.

### Running on every build

The simplest integration — add to the target project's `package.json`:

```json
{
  "scripts": {
    "prebuild": "vysk -c"
  }
}
```

`npm run build` will now run Vysk first automatically. A deeper
integration (an actual Next.js/webpack plugin hooking into the
bundler) is real additional scope — this covers "runs automatically"
without it, and pairs with the cache above so repeat builds only
process what changed.

## Publishing

Don't publish by hand — a single machine can only ever build the
`.node` binary for its own platform, so an `npm publish` run locally
would ship a package that only works there.

```bash
git tag v0.2.0
git push --tags
```

Pushing a version tag triggers `.github/workflows/release.yml`, which
builds the native addon on real Linux, Windows, and macOS (x64 + arm64)
runners, verifies each one actually loads before continuing, then
publishes a single package containing all four binaries. You can also
trigger it manually from the Actions tab (`workflow_dispatch`) without
pushing a tag. Requires an `NPM_TOKEN` secret in the repo's Settings →
Secrets and variables → Actions.

`.github/workflows/ci.yml` is separate — it just builds and tests on
each OS for every push/PR, as a sanity check. It doesn't publish
anything.

### Rewriting references (`vysk rewrite`)

Once `vysk -c` has optimized some images, `vysk rewrite`
updates your actual source code to point at the new files:

```bash
npx vysk rewrite
```

It reads `.vysk/cache.json` to find every image that's already
been converted, scans `.tsx`/`.jsx`/`.js`/`.css`/`.scss` for references
to those originals (JSX `src="..."`, CSS `background-image: url(...)`,
and local `import`/`require` specifiers), and — after showing the full
plan and asking for explicit `y`/`N` confirmation — rewrites them to
the `.webp`/`.avif` output. This is a **full replace**, not a
`<picture>`-with-fallback: once rewritten, the original file is no
longer referenced by your code at all.

Safety, all non-negotiable:
- Refuses to run on an unclean git working tree (or a non-git project)
  unless you pass `--force` — git is your real rollback path here.
- Always prints the complete plan before ever asking to apply it.
- Never writes without an explicit `y` — piped/non-interactive input
  safely defaults to No rather than guessing.
- Backs up every touched file's original content to
  `.vysk/rewrite-backups/<timestamp>/` before writing, in
  addition to whatever git already gives you.

This is regex/text-based matching, not an AST-aware codemod — dynamic
or computed paths (e.g. `` src={`/images/${slug}.jpg`} ``) won't be
caught. Always read the printed plan before answering `y`.

### Removing unused originals (`vysk clean`)

Once `rewrite` has pointed your source at the optimized files, the
original PNG/JPG is often dead weight. `vysk clean` finds
originals with a recorded conversion that no longer appear to be
referenced anywhere in scanned source, shows the full list with sizes,
and asks for confirmation before deleting them:

```bash
npx vysk clean          # shows the plan, asks to confirm
npx vysk clean --dry-run   # shows the plan, deletes nothing
```

Uses the exact same text-matching rules as `rewrite` — so it shares the
same blind spot: an image referenced only from a file type outside
`.tsx`/`.jsx`/`.js`/`.css`/`.scss` (a plain `.html` file, for instance),
or via a dynamic/computed path, won't be recognized as "referenced" and
could be flagged even though it's still in use. "Not referenced" here
is evidence, not proof — review the printed list before confirming.
Same safety model as `rewrite`: refuses to run on an unclean git tree
unless `--force` is passed.

### Undoing a rewrite (`vysk undo`)

`rewrite` backs up every file it touches to
`.vysk/rewrite-backups/<timestamp>/` before writing — `undo`
is what actually reads that backup back:

```bash
npx vysk undo             # restores the most recent backup
npx vysk undo --list      # lists available backups, newest first
npx vysk undo <timestamp> # restores a specific one
```

Same safety model again: shows the full list of files it's about to
overwrite, asks for confirmation, and refuses on an unclean git tree
unless `--force` is passed.

### Checking your setup (`vysk doctor`)

```bash
npx vysk doctor
```

Confirms Node.js is a supported version, the native addon actually
loads on this platform, your project root can be found, and
`.vysk/cache.json` (if present) is valid JSON. Read-only, no
confirmation needed — safe to run any time, and the first thing worth
running if something's not working after install.

## Roadmap

**Phase 1 — Optimize** ✅ done (`v0.x`)
CLI-triggered, one-shot conversion. Non-destructive: only `.webp`/`.avif`
files are written, originals are never touched.

**Phase 2 — Automate** ✅ done (`v1.x`)
Hash-based caching (`.vysk/cache.json`) so only new/changed images
get reprocessed, a config file for defaults, and a `prebuild` script
pattern to run automatically on every build. Still non-destructive.

**Phase 3 — Website intelligence** 🚧 in progress (`v2.x`)
Reference rewriting (`vysk rewrite`), removing now-unused
originals (`vysk clean`), and restoring a rewrite (`vysk
undo`) are all done — see above. Still to come: responsive
variants/`srcset`, oversized-image detection.

**Also shipped:** `vysk doctor` (environment diagnostics) and
`--json` output on `-c` for CI/scripting.

## License

MIT — see [LICENSE](./LICENSE).