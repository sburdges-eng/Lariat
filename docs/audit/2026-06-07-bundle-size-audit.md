# Bundle-Size Audit - Next 16 / React 19 / Electron 42

Roadmap row: `2.20`

## Scope

- Affected subsystem: production Next build, desktop Electron build, first-run wizard Vite output.
- Freeze-readiness impact: closes the post-upgrade bundle-size audit and establishes a repeatable drift baseline.
- Determinism impact: audit reads local build artifacts only, reports repo-relative paths only, and emits stable `schemaVersion` JSON ordering.
- Security impact: no runtime behavior change; no cloud API dependency; no new runtime coupling.

## Commands

Current post-bump measurement:

```bash
npm run desktop:build
npm run bundle:audit -- --top 12
```

Pre-bump comparison measurement:

```bash
git worktree add --detach ../Lariat-worktrees/codex-bundle-size-prebump 30d9232^
cd ../Lariat-worktrees/codex-bundle-size-prebump
npm ci --prefer-offline --no-audit --fund=false
npm run desktop:build
cd ../codex-bundle-size-audit
node scripts/bundle-size-audit.mjs --root ../codex-bundle-size-prebump --top 12
```

## Comparison

Pre-bump commit: `203b21f` (`30d9232^`) with Next 14.2.15, React 18.3.1, Electron 31.7.7, Vite 5.4.21.

Post-bump commit: current main baseline `999df28` with Next 16.2.6, React 19.2.6, Electron 42.1.0, Vite 8.0.13.

| Metric | Pre-bump | Post-bump | Delta |
|--------|----------|-----------|-------|
| Routes | 191 total / 80 app / 111 API | 199 total / 83 app / 115 API | +8 total |
| Prerendered routes | 12 | 13 | +1 |
| Next static JS | 1,226,719 B / 392,569 gzip | 1,509,334 B / 506,209 gzip | +282,615 B / +113,640 gzip |
| Next static CSS | 97,463 B / 19,944 gzip | 96,841 B / 19,820 gzip | -622 B / -124 gzip |
| Next server JS | 4,882,609 B / 1,220,672 gzip | 8,473,695 B / 2,289,706 gzip | +3,591,086 B / +1,069,034 gzip |
| Edge runtime files | 227,665 B / 63,648 gzip | 278,291 B / 81,079 gzip | +50,626 B / +17,431 gzip |
| Desktop wizard JS | 145,160 B / 46,785 gzip | 194,626 B / 60,768 gzip | +49,466 B / +13,983 gzip |
| Desktop wizard total | 147,460 B / 47,899 gzip | 196,905 B / 61,858 gzip | +49,445 B / +13,959 gzip |

## Current Largest Assets

| Path | Bytes | Gzip bytes |
|------|-------|------------|
| `.next/server/chunks/7277.js` | 378,259 | 97,420 |
| `.next/static/chunks/4330-d7486d433c370d96.js` | 222,200 | 60,966 |
| `.next/static/chunks/4be3113d-ec4eca5e806f9906.js` | 199,864 | 62,734 |
| `.next/static/chunks/framework-45920cebdcacb3ca.js` | 189,675 | 59,579 |
| `.next/server/chunks/454.js` | 151,912 | 41,715 |
| `.next/static/chunks/main-652d899b9862f72c.js` | 141,992 | 40,083 |
| `.next/server/middleware.js` | 139,536 | 44,593 |
| `.next/server/edge-instrumentation.js` | 136,864 | 35,468 |
| `.next/static/chunks/polyfills-42372ed130431b0a.js` | 112,594 | 39,520 |
| `.next/server/chunks/2127.js` | 100,316 | 22,856 |
| `.next/server/chunks/6188.js` | 100,052 | 22,766 |
| `.next/server/app/api/kitchen-assistant/route.js` | 78,453 | 24,304 |

## Finding

The upgrade did create measurable drift, concentrated in server-side artifacts rather than CSS or the static shell:

- Client static JS grew 23.0% raw and 29.0% gzip.
- Server JS grew 73.5% raw and 87.6% gzip.
- Edge runtime files grew 22.2% raw and 27.4% gzip.
- The desktop first-run wizard JS grew 34.1% raw and 29.9% gzip.

The route surface also grew between the two commits, so the server delta is not a pure dependency-only comparison. The app remains pinned to webpack for production builds (`next build --webpack`), and the measured edge bundle still stays small enough that the Node-only chains aliased in `next.config.mjs` are not leaking native packages into the edge runtime.

Repeated post-bump builds kept raw byte counts stable; server gzip counts can move by a few hundred bytes because Next emits per-build identifiers into generated server artifacts. Treat the threshold below as a drift signal, not a bit-for-bit package hash.

## Invariants

- `npm run build` and `npm run desktop:build` remain offline/local build paths.
- `npm run bundle:audit` fails closed if `.next/BUILD_ID` is missing.
- Audit output uses `schemaVersion` as the first JSON key.
- Audit output never emits absolute filesystem paths.
- Desktop wizard output is optional for a Next-only build and measured when `desktop/dist/wizard` exists.

## Follow-Up Threshold

Treat the post-bump values above as the freeze baseline. Future work should investigate if any of these increase by more than 10% without a matching route or dependency explanation:

- Next static JS gzip: 506,209 bytes.
- Next server JS gzip: 2,289,706 bytes.
- Edge runtime gzip: 81,079 bytes.
- Desktop wizard JS gzip: 60,768 bytes.
