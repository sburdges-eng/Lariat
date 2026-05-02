# Breaker Audit — 2026-05-02 — Section 6

**Section covered:** 6 — Kitchen Assistant / Specials / Ollama / Data Pack degraded states.

**Auditor:** claude

**Read-only:** YES.

**GitNexus:** fresh from prior reindex.

---

## Method

Applied the new "doc-vs-code drift" prong (added at the end of Section 5's audit) by reading `docs/ARCHITECTURE.md` "Data Pack" section + `CLAUDE.md` "Kitchen Assistant" section first, extracting the explicit doc claims, then verifying each against the code.

Then the standard six-prong checklist over: `app/api/kitchen-assistant`, `app/api/specials`, `lib/ollama.ts`, `lib/datapackSearch.ts`, `lib/complianceSearch.ts`, `lib/computeEngine/sandboxCosting.ts`.

---

## Doc-vs-code drift verification (new prong)

| Doc claim | Source | Verified? |
|---|---|---|
| Ollama down → 502 (POST), `ollamaReachable: false` (GET ping) | CLAUDE.md "Kitchen Assistant" | ✓ KA route line 597 (502); GET ping line 79–81 |
| `lib/ollama.ts::ollamaChat()` sends `think: false` on every request | CLAUDE.md | ✓ `lib/ollama.ts:144` |
| Legacy `LARIAT_ASSISTANT_ENABLED` flag has been removed | CLAUDE.md | ✓ zero matches across the repo |
| Data Pack client is graceful-degraded; `available()` returns false on missing symlink, never throws | CLAUDE.md "Data Pack" + `docs/ARCHITECTURE.md` | ✓ `lib/datapackSearch.ts:85–90, 220–230` |
| Hybrid search = FTS5 ⊕ BGE via RRF | CLAUDE.md | ✓ `lib/datapackSearch.ts` (FTS path) + BGE path via `transformers.js` |
| Vectors streamed from per-bucket `vectors.npy` | CLAUDE.md | ✓ `.npy` reader at `lib/datapackSearch.ts:519+` and `lib/complianceSearch.ts:311+` |
| Symlinked into `data/lariat-data` | CLAUDE.md | ✓ `lib/datapackSearch.ts:11, 30+` SYMLINK_PATH constant |
| LLM-action JSON pattern: `extractAction()` intercepts `{action, ...}` | `docs/PATTERNS.md §10` | ✓ `app/api/specials/route.js:19, 110`; KA route similar |
| Static imports for compute helpers (no dynamic `await import('./lib/computeEngine/*')`) | `docs/PATTERNS.md §10` | ✓ zero dynamic imports in KA / specials route |

**Three audits in a row** had a doc claim NOT delivered. **This audit found NONE** — every doc claim in Section 6 holds. The new "doc-vs-code drift" prong was applied first as a sanity check; everything passed. The findings below are pure boundary-validation gaps, not doc/code mismatches.

---

## Findings

| # | Priority | Title |
|---|---|---|
| 1 | **P3** | `cost_special` LLM action in `/api/specials` doesn't validate per-field types of `ingredients[]` (only `Array.isArray`); other LLM actions in the same family (`scale_recipe`, `log_haccp_receiving`, etc.) DO validate at the route boundary. [Full record](findings/2026-05-02-cost-special-payload-shape-not-validated.md). |

No P0, P1, or P2 findings this pass.

---

## Verified-correct surfaces

- **`lib/ollama.ts::ollamaChat`** — throws on non-2xx, throws on missing message content. Caller handles → 502 in routes. AbortController for the 45s default timeout.
- **`/api/kitchen-assistant/route.js`** — outer try/catch returns 502 on Ollama failure (line 597). Every per-action handler (scale_recipe, log_haccp_receiving, update_order_guide, generate_prep, beo_add_prep) validates field types BEFORE flowing into compute helpers. `extractAction()` returns `{ payload: null, stripped }` on JSON parse failure (line 56 graceful catch).
- **`/api/specials/route.js`** — same 502 path; calculator-driven cost path is documented as "deterministic Lariat backend will intercept this JSON". The shape gap (finding #1) is the only crack.
- **`lib/datapackSearch.ts`** — `available()` ✓; `_availableOverride` test hook ✓; `getConn()` returns null on missing symlink ✓; `fts()` short-circuits on `!conn` (line 226–227); never throws on missing data pack.
- **`lib/complianceSearch.ts`** (just merged in #89) — same shape: `available()` ✓, `getConn()` returns null on missing files (line 100), no throws on graceful-degrade path. The .npy reader throws on malformed files (lines 311+) which is correct: a present-but-corrupt data pack should fail loud, not silently.
- **No dynamic imports** for compute helpers in either KA or specials route. PATTERNS.md §10 holds.
- **No legacy `LARIAT_ASSISTANT_ENABLED` flag** anywhere in the repo. The cleanup that CLAUDE.md describes actually completed.

---

## Test gaps surfaced

- **No `tests/js/test-specials-cost-action-shape.mjs`.** The `cost_special` route doesn't have a regression test for malformed payload shapes (item=null, unit=array, etc.). Pair this with finding #1's fix.
- The Ollama-down 502 path is well-tested (multiple route tests stub `globalThis.fetch`); the data-pack-missing path is also well-covered (`_setAvailableOverrideForTest` hook). No gap there.

---

## Recommended next moves

1. **Fix finding #1** — small per-field guard at the route boundary plus a paired test. ~30 lines total.
2. **Section 7 next pass** — UI copy + money formatting. Closing the audit loop. Lower expected finding density (no regulated invariants in that section), but PR #96's CRITICAL "rollup tile jargon" finding suggests the convention is enforced unevenly across surfaces.
3. **Section 8 (offline / PWA / e2e)** — last section. Tests-and-build territory; mostly verifies that the existing test suites pin the regulated invariants the prior sections found. Worth doing AFTER 7 since 7 might surface UI test gaps.

---

## Stop conditions hit

None.

---

## Workflow notes

- The "doc-vs-code drift" prong worked. Applying it FIRST (before the six-prong checklist) gave fast confidence that Section 6 wasn't going to surface another P0 like the prior three sections. Going to fold this into BREAKER_AUDIT.md §3 as the implicit zeroth prong: "If the subsystem has a written design doc, extract its claims and verify each before running the six-prong checklist."
- Sections 4 + 5 had an interesting pattern: the doc CORRECTLY described the desired contract; the CODE had drifted. Section 6 inverted: doc and code were aligned; the gap was a single boundary-validation oversight on a newer feature path. That's a good signal — it suggests the older subsystems accumulated drift over multiple iterations, while newer ones (Section 6's KA + specials are heavily-tested in PR #77, #89) tend to honor the convention from day one.
