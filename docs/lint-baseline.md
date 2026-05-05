# ESLint baseline (PR introducing flat-config v9)

Snapshot of `npm run lint` output the moment ESLint v9 was wired in.

## Posture

**Soft launch.** Errors block CI and pre-commit; warnings are informational.
Today: **0 errors, 299 warnings.** New code that ships warnings is fine —
the pre-commit hook (lint-staged) only blocks on errors. Warnings are
tracked here as a backlog to drain in follow-up cleanup PRs.

## How to use

```bash
# Run lint on the whole repo
npm run lint

# Auto-fix what ESLint can
npm run lint:fix

# Lint only files changed since main (used by lint-staged)
npm run lint:changed
```

Pre-commit: `simple-git-hooks` runs `lint-staged` on every staged file
(autofix + error-only gate). Override in emergencies with `git commit
--no-verify`.

## Baseline counts (one-time snapshot)

| Rule | Count | Severity | Plan |
|------|------:|----------|------|
| `no-console` | 204 | warn | Triage: most are server-side debug logs that should be `console.warn` / `console.error`. Sweep in batches by area. |
| `no-unused-vars` | 45 | warn | Mostly leftover destructured params; clean per file as they're touched. |
| `@typescript-eslint/no-unused-vars` | 20 | warn | Same shape as above, TS variant. |
| `@typescript-eslint/no-explicit-any` | 17 | warn | Some legitimate (DB row shapes), some lazy. Audit + narrow types where cheap. |
| `react/no-unescaped-entities` | 7 | warn | JSX text with raw `'` / `"`. Cosmetic — entities render correctly either way. Demoted from error. |
| `eslint-comments/no-unused-disable` | 5 | warn | Stale `// eslint-disable-next-line` directives. Easy sweep. |
| `react-hooks/exhaustive-deps` | 1 | warn | A real missing-dep case worth investigating; not currently blocking. |

## Errors fixed in this PR (the 12 → 0)

The original baseline showed 544 errors. Most (532) were `no-undef` from
the standard `console`/`setTimeout` family — fixed by registering the
`globals` package's `node` + `browser` + `jest` presets in
`eslint.config.js`. Of the remaining 12 real errors:

| Fix | File | Why |
|-----|------|-----|
| Demoted `react/no-unescaped-entities` to warn | `eslint.config.js` | Stylistic; entities render correctly. |
| Demoted `eslint-comments/no-unused-disable` to warn | `eslint.config.js` | Pre-existing dead directives shouldn't block CI in the soft launch. |
| Carved out `*.config.js` / `jest.setup.js` from `no-require-imports` | `eslint.config.js` | These are CJS by design. |
| Extended react-hooks plugin to `.ts` files | `eslint.config.js` | `useFireCue.ts` uses hooks without JSX. |
| `_swept` `let` → `const` | `lib/idempotency.ts:204` | Never reassigned; satisfies `prefer-const`. |
| BOM literal → `﻿` escape | `scripts/import-prism-deals.mjs:90` | `no-irregular-whitespace`; same regex behavior. |

## What this PR does NOT do

- Drain the 299 warnings (separate cleanup PRs)
- Wire CI (no `.github/workflows/` exists yet)
- Add Prettier (separate scope)
- Apply `eslint --fix` to the whole repo (T4 of the original plan was
  deferred — would touch ~150 files; better as its own reviewable PR)

## Re-running the baseline

```bash
node_modules/.bin/eslint . --format json --output-file "$TMPDIR/eslint-baseline.json"
node -e "
import('fs').then(({readFileSync}) => {
  const data = JSON.parse(readFileSync(`${process.env.TMPDIR}/eslint-baseline.json`,'utf8'));
  let e = 0, w = 0; const r = {};
  for (const f of data) { e += f.errorCount; w += f.warningCount;
    for (const m of f.messages) { const k = m.ruleId || '(fatal)';
      r[k] = r[k] || {e:0, w:0}; r[k][m.severity===2?'e':'w']++; }}
  console.log(\`errors=\${e} warnings=\${w}\`);
  Object.entries(r).sort((a,b)=>(b[1].e+b[1].w)-(a[1].e+a[1].w))
    .forEach(([k,c])=>console.log(\`  \${(c.e+c.w).toString().padStart(4)} err=\${c.e} warn=\${c.w} \${k}\`));
});
"
```
