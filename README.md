# ImageForge

Optimize website images so pages load faster and use less bandwidth.
Scans a project for PNG/JPG/JPEG and converts them to WebP — smaller,
same quality, original files untouched.

```bash
npm install -D imageforge
npx imageforge -c
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
node /path/to/imageforge/dist/cli.js -c
```

### CLI options

| Flag | Description | Default |
| --- | --- | --- |
| `-c`, `--compress` | Scan configured paths and optimize | — |
| `-q`, `--quality <n>` | Encode quality, 0-100 (WebP, or AVIF for oversized images) | `82` |
| `--lossless` | Force lossless WebP encoding | `false` |
| `--no-cache` | Ignore the cache and reprocess every image | — |
| `--dry-run` | Show what would happen — no files written, cache untouched | — |
| `-h`, `--help` | Show help | — |

### Config file

`imageforge.config.js` in the project root (CommonJS, same convention
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

Results are cached in `.imageforge/cache.json` (already gitignored).
An image is only reprocessed if any of these changed since the last
run: the file's content, the `quality`/`lossless` settings, or the
installed imageforge version. If the cached output file has been
deleted, it's treated as a miss and reprocessed. Use `--no-cache` to
bypass the cache entirely.

### Running on every build

The simplest integration — add to the target project's `package.json`:

```json
{
  "scripts": {
    "prebuild": "imageforge -c"
  }
}
```

`npm run build` will now run ImageForge first automatically. A deeper
integration (an actual Next.js/webpack plugin hooking into the
bundler) is real additional scope — this covers "runs automatically"
without it, and pairs with the cache above so repeat builds only
process what changed.

## Publishing

```bash
npm run build
npx napi create-npm-dirs   # sets up per-platform package folders under npm/
npm publish
```

The CI workflow in `.github/workflows/ci.yml` builds and tests on
Linux/macOS/Windows for the host architecture. Cross-compiling the full
target matrix (linux-musl, arm64, etc.) needs additional toolchains per
target — see the [napi-rs docs](https://napi.rs/docs/) when you're ready
to publish multi-platform binaries.

### Rewriting references (`imageforge rewrite`)

Once `imageforge -c` has optimized some images, `imageforge rewrite`
updates your actual source code to point at the new files:

```bash
npx imageforge rewrite
```

It reads `.imageforge/cache.json` to find every image that's already
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
  `.imageforge/rewrite-backups/<timestamp>/` before writing, in
  addition to whatever git already gives you.

This is regex/text-based matching, not an AST-aware codemod — dynamic
or computed paths (e.g. `` src={`/images/${slug}.jpg`} ``) won't be
caught. Always read the printed plan before answering `y`.

## Roadmap

**Phase 1 — Optimize** ✅ done (`v0.x`)
CLI-triggered, one-shot conversion. Non-destructive: only `.webp`/`.avif`
files are written, originals are never touched.

**Phase 2 — Automate** ✅ done (`v1.x`)
Hash-based caching (`.imageforge/cache.json`) so only new/changed images
get reprocessed, a config file for defaults, and a `prebuild` script
pattern to run automatically on every build. Still non-destructive.

**Phase 3 — Website intelligence** 🚧 in progress (`v2.x`)
Reference rewriting (`imageforge rewrite`) is done — see above. Still
to come: detecting/removing now-unused originals (safe now that full
replace means "referenced" is unambiguous), responsive variants/`srcset`,
oversized-image detection.

## License

MIT — see [LICENSE](./LICENSE).
