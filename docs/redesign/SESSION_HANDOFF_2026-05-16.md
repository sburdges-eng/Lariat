# LaRi expansion + audit + UI redesign — session handoff

**Branch:** `feat/lari-expansion-and-audit` (created locally, NOT pushed)
**Date:** 2026-05-16
**Session goal:** Expand LaRi to search the DB & codebase in natural language; audit the bundled app for shortcomings; sketch a new UI design.

## Sandbox limitations to know

1. **Couldn't commit.** A stale `.git/index.lock` is held by a permission the Cowork sandbox can't release. To unblock on macOS:
   ```bash
   cd ~/Dev/Lariat && rm -f .git/index.lock
   ```
2. **Couldn't run the JS test suite.** `better-sqlite3`'s native binary was compiled for macOS-arm64 and won't load in the Linux sandbox. I substituted a Python-sqlite3 static validator (`scripts/validate-db-query-registry.py`) which caught the column-name drift in my first draft.
3. **No GitNexus MCP available.** CLAUDE.md mandates `gitnexus_impact` before editing any symbol. I substituted manual impact analysis (grep callers, read tests, read call sites). Findings: the touched symbols (`buildGroundedContext`, `kitchenAssistantPostHandler`, `GROUNDED_SYSTEM`, `NAV_ITEMS`) have no callers outside the files I edited — except `GROUNDED_SYSTEM` which is imported by `app/api/specials/route.js`. The change to `GROUNDED_SYSTEM` is **additive** (a new rule #11 about `db_query`), so the specials route remains functionally identical — but you should sanity-check that one.

## What landed (and where to commit it)

Recommend three separate commits so each can be reviewed independently. Run the tests + validator listed against each before pushing.

### Commit 1 — `feat(lari): db_query action expanding LaRi to natural-language DB search`

**Files (new):**
- `lib/dbQueryTool.ts` (446 lines) — runner, types, registry loader, prompt-catalog rendering, formatQueryResultForPrompt.
- `lib/dbQueryRegistry.ts` (548 lines) — 24 vetted queries (12 cook-tier, 12 manager-tier). SQL is hardcoded; LLM picks name + supplies params; runner forces `:location_id`.
- `tests/js/test-db-query-tool.mjs` (383 lines) — safety (unknown query / tier_blocked / location-spoof / injection / row-cap), shape (param validation / audit emission / redaction), catalog (tier filter / SQL compiles against schema).
- `scripts/validate-db-query-registry.py` (239 lines) — sandbox-friendly static SQL canary (executes every query against a minimal schema replica with dummy params). Catches column-name drift that the JS test would miss when the native binary is unavailable.

**Files (modified):**
- `app/api/kitchen-assistant/route.js` — imports `runDbQuery` / `renderQueryCatalog` / `formatQueryResultForPrompt`; appends the catalog after `CONTEXT`; new branch in the action dispatcher handles `db_query` BEFORE the question/command paths.
- `lib/ollama.ts` — adds rule #11 to `GROUNDED_SYSTEM` teaching the LLM how to emit `db_query`. **Reach:** `GROUNDED_SYSTEM` is also imported by `app/api/specials/route.js`. The change is additive (a new rule), but worth a manual look.
- `package.json` — adds `test:db-query-tool` and `validate:db-query-registry` scripts.

**Tests to run (on macOS):**
```bash
npm run validate:db-query-registry        # MUST pass — 24/24
npm run test:db-query-tool                # the new Node test suite
npm run test:rules                        # nothing in here changed but it's a sanity check
node --experimental-strip-types --check lib/ollama.ts
node --experimental-strip-types --check lib/dbQueryTool.ts
node --experimental-strip-types --check lib/dbQueryRegistry.ts
node --check app/api/kitchen-assistant/route.js
```

**Manual smoke test:**
1. Start Ollama + `npm run dev`.
2. Open `/kitchen-assistant`, tier = cook.
3. Ask: "any cooling cycles in progress?" → expect a `db_query` JSON, table of in-progress cycles.
4. Ask: "what did we sell yesterday?" → expect "manager PIN required" (sales_by_dish is manager-tier).
5. Enter manager PIN, retry → expect a sales table.
6. Verify `audit_events` has new rows with `entity='db_query', action='view'`.

**Safety properties enforced (one-line summary each):**
- No LLM-authored SQL — LLM picks query NAME only.
- `:location_id` always bound from request, never from LLM params.
- Manager-tier queries require `hasPin` (same auth model as `buildGroundedContext`).
- Row caps enforced per query (default 50, hardcoded).
- Read-only SQL guard (rejects non-SELECT/WITH statements).
- Audit-event per call inside a tx (uses CHECK-allowed `'view'` action — `'query'` would fail the constraint).
- Free-text params (`search`, `item`, `ingredient`, `recipe_id`) redacted from audit payload.

---

### Commit 2 — `chore(env): rebuild .env.example from union of LARIAT_* references (audit F2)`

**Files (modified):**
- `.env.example` — rebuilt with all 30+ `LARIAT_*` env vars referenced in code, grouped by integration, marked SECRET where applicable. Notes the `LARIAT_LOCATION` ↔ `LARIAT_LOCATION_ID` and `LARIAT_7SHIFTS_API_KEY` ↔ `LARIAT_SEVENSHIFTS_API_KEY` rename collisions for future cleanup.

**Verification:**
```bash
comm -23 \
  <(grep -rh "process.env.LARIAT_" app/ lib/ scripts/ | grep -oE "LARIAT_[A-Z0-9_]+" | sort -u) \
  <(grep -oE "LARIAT_[A-Z0-9_]+" .env.example | sort -u)
# expected: empty output
```

---

### Commit 3 — `chore(nav): add 7 missing HACCP boards to navRegistry (audit F1)`

**Files (modified):**
- `app/_components/navRegistry.js` — adds `fs-cooling`, `fs-date-marks`, `fs-sanitizer`, `fs-cleaning`, `fs-sick-worker`, `fs-pest`, `fs-sds` to NAV_ITEMS. Palette-only (sidebar already shows the food-safety hub which links to all of them). Shortcuts left blank — single-letter space is full.

**Verification:**
```bash
node --check app/_components/navRegistry.js
# In dev: cmd+K → type "cooling" → expect the new entry.
```

---

### Commit 4 (optional) — `docs(audit): integration audit + UI redesign demo`

**Files (new):**
- `docs/INTEGRATION_AUDIT.md` (164 lines) — Audit report with 8 findings (F1–F8) tagged S1/S2/S3 and remediation sketches.
- `docs/redesign/lari-ui-demo.html` (587 lines) — Self-contained design prototype showing the proposed visual language.
- `docs/redesign/SESSION_HANDOFF_2026-05-16.md` — this file.

---

## What remains in the audit (NOT fixed this session)

Per `docs/INTEGRATION_AUDIT.md`, six findings beyond the two I fixed:

| ID  | Severity | What                                                                                  |
|-----|----------|---------------------------------------------------------------------------------------|
| F3  | S2       | 37 of 112 API routes have no API-test file. Highest priority: `/api/kds/tickets/[id]/bump` (the Swift sibling protocol). |
| F4  | S3       | 256 source files carry `@ts-nocheck`. Migrate on-touch. |
| F5  | S3       | `/concept-layout` page reads like an orphan prototype — confirm with `git log` and delete if confirmed. |
| F6  | S2       | `vendor_prices_history` has no dedicated UI surface. The new `db_query` action gives LaRi a chat-path to it; a dashboard is the larger fix. |
| F7  | S2       | `LARIAT_LOCATION` vs `LARIAT_LOCATION_ID` env-name collision. Pick one, deprecate the other. |
| F8  | S2       | `LARIAT_7SHIFTS_API_KEY` vs `LARIAT_SEVENSHIFTS_API_KEY` — same shape. |

## What was deferred

- **Phase 1.2 — dev-mode code-search action.** I judged it not worth bundling into the LaRi expansion commit (env-gated, different security model, no shared infrastructure). Sketch in task #10 of the task list. Easiest path: add a `code_search` registered action that shells to ripgrep with safe args, gated by `LARIAT_DEV_MODE=1` AND manager PIN.
- **Phase 3 — production UI migration.** The `docs/redesign/lari-ui-demo.html` proves the design language. A real migration would happen as a parallel route tree (`/v2/...`) behind a feature flag, sharing the existing APIs. The CSS variables at the top of the demo are the design-token catalog the implementation would consume.

## Open question for you

The system prompt for `GROUNDED_SYSTEM` is also used by `/api/specials` (the Specials Sandbox). I added rule #11 about `db_query`, but the specials route doesn't handle the `db_query` action — it would emit JSON and the specials backend would strip it as prose. Two options:

1. **Status quo.** Accept that specials-mode LLM might emit a useless `db_query` JSON that gets stripped. Low-likelihood (the specials prompt steers it toward `cost_special`), low-impact.
2. **Use a slimmer system prompt for specials.** Extract a `GROUNDED_SYSTEM_BASE` (rules 1–10) and have the kitchen-assistant route use `GROUNDED_SYSTEM_BASE + DB_QUERY_RULE` while specials uses `GROUNDED_SYSTEM_BASE` alone. Cleaner separation.

I went with (1) for this session. Flip me a note if you want (2) — small refactor, fits in commit 1.
