# `checkJs` migration (GH #250)

Posture: **opt-out**. As of this PR, `tsconfig.json` runs with `checkJs: true`,
so any new `.js` / `.jsx` / `.mjs` file in the repo is type-checked by default.
The 249 existing JS/JSX files that produced errors when the flag flipped have
been pinned with a `// @ts-nocheck — pre-#250 baseline …` header so the gate
goes green without rewriting all of them at once. That header is the migration
TODO list — find one, fix it, drop the line.

## Why this shape

Pre-fix, `checkJs: false` meant ~40 regulated API route handlers (all `.js`)
were parsed for module resolution but received zero semantic checking. Bugs
that `strict + noUncheckedIndexedAccess` would catch in `.ts` slipped through.
The 2026-05-08 audit found correctness-class bugs (`give_gold_star`
`stars || 1` fallback, `line_check` bare `Number()`) that a JSDoc cast at the
top of the route would have surfaced.

Turning on `checkJs` produced 2,848 errors across 249 files when first
enabled — way too many for a single PR to drain, and most were noise
(`Property 'message' does not exist on type '{}'` on `req.json()` calls).
Per the issue's phased plan:

- **P1 (this PR):** flip `checkJs: true`, `// @ts-nocheck` the noisy files,
  add ONE demonstration route (peers) with full JSDoc.
- **P2 (separate PRs):** migrate the highest-risk handlers
  (`kitchen-assistant`, `checks`, `signoff`, `eighty-six`, `inventory`,
  the temp-PIN auth routes) to `.ts` or to clean JSDoc.
- **P3:** lint rule banning new `.js` route handlers under `app/api/` once
  the migration drains.

## How to migrate one file

1. Delete the `// @ts-nocheck` header.
2. Run `npx tsc --noEmit` and read the errors.
3. Add JSDoc typedefs at the top of the file. Common patterns:
   - Route handler signature: `/** @param {Request} req */`
   - Lib type import:
     `/** @typedef {import('../../../lib/foo.ts').FooType} FooType */`
   - Cast: `const x = /** @type {Foo} */ (rawValue)`
4. For request bodies, type the parsed JSON:

   ```js
   /** @type {{ item?: string; reading_f?: number }} */
   const body = await req.json();
   ```

5. Once typecheck is clean, commit. No production-code change is required
   — the migration is type-system-only.

## Demonstration route

`app/api/peers/route.js` is the reference. Headed with `// @ts-check`,
imports `DiscoveredInstance` via a `@typedef` JSDoc, and types every
function parameter. A typo in a peer-field name, or a rename of
`DiscoveredInstance.txt.pubkey_fp` in `lib/mdnsDiscovery.ts`, fails
`npm run typecheck` here. That validates the third acceptance criterion
on the issue: a lib-signature change surfaces in at least one JS route.

## Order of attack

Migration priority, highest first:

| File | Risk | Why |
|------|------|-----|
| `app/api/kitchen-assistant/route.js` | HIGH | ~700 lines, runs LLM-emitted actions against regulated tables. |
| `app/api/signoff/route.js` | HIGH | Station signoffs are HACCP defense. |
| `app/api/eighty-six/route.js` + `eighty-six/resolve/route.js` | HIGH | 86 board writes. |
| `app/api/checks/route.js` | HIGH | Line-check entries (temps, glove change). |
| `app/api/inventory/route.js` | HIGH | Inventory delta writes. |
| `app/api/auth/pin/*.js` | HIGH | PIN gate / temp-PIN issuance. |
| `app/api/breaks/route.js`, `certifications/*` | MEDIUM | Labor compliance. |
| The rest of `app/api/**/route.js` | LOWER | Generally smaller surface or read-only. |
| `app/__tests__/*.test.jsx` | LOWEST | Tests run against real DB anyway; weak typing tolerable. |

Each migration is its own PR per the project's "one-bounded-PR" convention.
