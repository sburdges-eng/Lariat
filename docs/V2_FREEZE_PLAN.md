# Lariat v2 Freeze Plan — 2026-05-24

**Purpose.** A *verified* inventory of every Lariat subsystem (features, engines, language
models, workflows), with a hard line drawn for the v2 freeze: what is locked, what must be
closed before freeze, and what is explicitly deferred. Built by reading code — **not** commit
messages — after the `ed0b32e` "complete project integration" commit landed (2026-05-24).

**Method.** Six parallel read-only verification sweeps over `app/`, `lib/`, `scripts/`,
`training/`, `cad-kernel/`, plus four hand-verified spot checks on the load-bearing drift
findings. Every status below is grounded in a `file:line` observation. No code was modified
in producing this plan.

**Headline finding.** The codebase is in good shape — the large majority of subsystems are
genuinely complete and production-ready. **But the `ed0b32e` commit message overclaims in six
places.** Commit prose describes work that is not in the tree (or is intentionally stubbed).
A freeze cannot ship on top of a false "done" narrative, so reconciling those six claims is the
gating work before v2 locks. None of the overclaimed items are *active bugs* — they are dead
code, config drift, or by-design v1 stubs — so there is no fire to put out, only honesty to
restore.

---

## Status legend

- **FROZEN** — complete, wired, production-ready. In v2 scope, locked. Do not reopen.
- **FIX-BEFORE-FREEZE** — small, bounded work required to make v2 honest/consistent.
- **DEFERRED** — real work, explicitly out of v2 scope. Tracked for a later phase.
- **SCOPE-DECISION** — needs a human product/architecture call before it can be classified.

---

## 1. Subsystem status matrix

### AI / Language-model stack

| Subsystem | Status | Evidence | Note |
|-----------|--------|----------|------|
| Kitchen Assistant → Ollama | **FROZEN** | `app/api/kitchen-assistant/route.js:7`, `app/api/specials/route.js:84` call `ollamaChat()`; no feature flag | Matches CLAUDE.md |
| `db_query` LLM action | **FROZEN** | `lib/dbQueryRegistry.ts` (45 queries), tier-gated in `lib/dbQueryTool.ts::runDbQuery()`, audit-wrapped at `app/api/kitchen-assistant/route.js:203` | Injection-safe, location-scoped, 50-row cap |
| Data Pack hybrid search | **FROZEN** | `lib/datapackSearch.ts` RRF fusion (FTS5 ⊕ BGE), graceful-degraded via `available()`; `test:datapack` 3/3 | "normalize dispatcher wired" claim is cosmetic overclaim — no central dispatcher exists |
| Prompt eval harness | **FROZEN** | `training/eval/` + `npm run eval:assistant-prompt`; 10/10 locked baseline | Does not yet eval the new Qwen checkpoint |
| **Model: Qwen vs DeepSeek default** | RESOLVED (kept DeepSeek) | `lib/ollama.ts:6` defaults to `lari-the-kitchen-assistant`; eval: DeepSeek 7/10 vs Qwen 1/10 on Ollama leg | Qwen fails the gate; do not flip. See §2.1 |
| MLX local fine-tune pipeline | DEFERRED (works) | `training/train-local.sh`, `mlx-lora-config-qwen.yaml`, `data-mlx/train.jsonl` (284 pairs) | Runnable; no post-train auto-eval gate |
| AWS SageMaker pipeline | DEFERRED (works, diverged) | `training/aws/deploy.sh`, `train_script.py` targets **Llama 3.1 8B**, not Qwen | Cloud training tooling only; model mismatch remains deferred. See §2.6 |
| SageMaker runtime inference | RESOLVED (removed) | `lib/sagemaker.ts` removed; zero imports in `app/`/`lib/` runtime | v2 runtime stays local Ollama; no cloud inference dispatch. See §2.6 |

### HACCP food-safety + labor compliance

| Subsystem | Status | Evidence | Note |
|-----------|--------|----------|------|
| 9 of 11 HACCP concepts | **FROZEN** | cooling, temp-log, receiving, sanitizer, sick-worker, cleaning, pest, sds, tphc — full 5-file shape | |
| `needs_corrective_action` 422 gate | **FROZEN** | `cooling:148`, `temp-log:107`, `receiving:212`, `sanitizer:68` | Binding HACCP rule enforced at write time |
| Audit transactionality | **FROZEN** | `postAuditEvent()` inside `db.transaction()` verified in cooling/temp-log/receiving/sick-leave | Source row + audit roll back together |
| Labor: breaks/sick-leave/wage-notices/tip-pool | **FROZEN** | each has `lib/*.ts` + API route + UI | |
| **date-marks** | RESOLVED (test exists) | `tests/js/test-date-mark-rules.mjs` covers rule thresholds; `tests/js/test-date-marks-api.mjs` covers API/location/audit | Original audit searched the plural filename |
| **calibrations** | RESOLVED (documented exception) | API lives at `app/api/thermometer-calibrations/route.js`; `tests/js/test-calibrations-rules.mjs` + `test-calibrations-api.mjs` cover the surface | Keep slug exception; renaming is cosmetic risk |
| labor: **certs** | SCOPE-DECISION | UI exists, no API/rule module | Is it informational-only or regulated? |

### Costing / compute / entity / depletion

| Subsystem | Status | Evidence | Note |
|-----------|--------|----------|------|
| Compute engine (3-step chain) | **FROZEN** | `lib/computeEngine/index.ts:32-47`; step 1 delegates to `computeCostVariance()` (`recipeCosting.ts:2,34`); triggered from `/api/compute/status:87` + `/api/receiving:351` | Single resolver, no divergence |
| Entity layer Phase 1 | **FROZEN** | `lib/entities.ts:142`; all 5 backfill scripts present | |
| Sales depletion Phase 3 | **FROZEN** | `lib/salesDepletion.ts` pure resolver + applier; `sales_depletion_runs` table `db.ts:2309`; wired via `ingest-analytics.mjs` | |
| JS↔Python parity | **FROZEN** | `unitConvert.mjs`↔`units.py`, `ingredientKey.ts`↔`ingredient_key.py` | |
| **Entity layer Phase 2 (UUID FKs)** | DEFERRED | only `entities_purchase_orders.vendor_uuid` exists (`db.ts:2163`); `vendor_prices`/`sales_lines`/`bom_lines`/`recipe_costs` have **no** UUID FK; no backfill migration | `ed0b32e` claims "Phase 2: UUID FK columns + backfill migration" — not implemented. See §2.2 |
| **Dish coverage snapshots** | RESOLVED (wired) | table added to `initSchema`; compute engine writes it (step 2b); `app/management/page.jsx` reads snapshot-first | Was dead code over a missing table. Fixed 2026-05-24. See §2.3 |
| Specials INTEGER→TEXT timestamp migration | (narrative only) | `specials` timestamps are INTEGER by original design; no such migration exists | `ed0b32e` claim is false; harmless. See §2.5 |

### Ingest / integrations / sync

| Subsystem | Status | Evidence | Note |
|-----------|--------|----------|------|
| Ingest pipelines (base/costing/analytics/toast/7shifts/prism) | **FROZEN** | Node `.mjs` wrappers + Python parsers; tx pattern at `ingest-costing.mjs:274` | No TODO/NotImplemented in core |
| Toast OAuth2 token refresh | **FROZEN** | `scripts/toast_api/auth.mjs:103` `isCacheStale()` w/ 5-min early refresh, 0600 cache | Roadmap's open question answered: refresh IS handled |
| Multi-instance sync | **FROZEN** | `lib/syncFeed.ts` appendOp/replaySince/checkpoint; `/api/peers/sync-since` Ed25519 auth | H1–H9/M1–M5 audit closed |
| Idempotency cleanup | **FROZEN** | `lib/idempotency.ts:90` lazy `sweepExpired()` per request | No unbounded growth |
| Env-var canonicalization (F7/F8) | **FROZEN** | `LARIAT_LOCATION_ID` + `LARIAT_7SHIFTS_API_KEY` canonical w/ legacy one-shot warnings | Commit `7caead3` |
| **7shifts rate-limit backoff** | DEFERRED | `scripts/sevenshifts_api/client.mjs` paginates with no backoff/429 handling | Risk only on >30-day, multi-employee backfills |
| **Prism integration** | DEFERRED (blocked) | `scripts/prism_api/client.mjs` is a guarded scaffold; `REAL_ENDPOINT_PATH=null`, throws until confirmed | Blocked on external API spec from Prism CSM |
| Cloud-bridge push | **FROZEN** | `lib/cloudBridge.ts:92` `pushSnapshot()`→`pushBatch()`; DLQ admin routes complete | |
| **Cloud-bridge `pullSnapshot`/`status`** | DEFERRED (by design) | `cloudBridge.ts:30` `CLOUD_BRIDGE_NOT_IMPLEMENTED`; comment: "stay stubbed in v1 — push is [priority]" | `ed0b32e` claims "pullSnapshot + status implementation" — intentional v1 stub, not done. See §2.4 |

### Live ops / KDS / venue / platform

| Subsystem | Status | Evidence | Note |
|-----------|--------|----------|------|
| KDS server protocol | **FROZEN** | `lib/kds.ts:100` `BumpResponse {id, bumped_at}`; bump route + tables; `test-kds-bump-route.mjs` present | Roadmap 1.3 done — bump route now tested |
| BEO + share-token flow | **FROZEN** | 8 routes; `test-beo-share-api.mjs` covers anonymous-token reads + signature + audit | Security-tested |
| Live ops (today / eighty-six / kds-punch) | **FROZEN** | pages wired in `navRegistry.js:78-98` | UI-only, no API layer |
| mDNS discovery | **FROZEN** (untested) | `lib/mdnsDiscovery.ts` advertise/discover, boot-wired via instrumentation | No isolated unit tests |
| Desktop / Electron | **FROZEN** | `desktop/main.ts`+`supervisor.ts`; Electron 42 + better-sqlite3 12; DMG builds to `dist/` | #257, #264 |
| Build pipeline | **FROZEN** | `--webpack` present on dev/build/desktop:build; `next.config.mjs` dual-runtime aliasing | Turbopack not used (by design) |
| Floor-plan (SVG zones) | **FROZEN** | `Floorplan.jsx` hand-drawn zones, no CAD dependency | |
| **Shows / live-music venue** | DEFERRED (test-harden) | production-active surface; **9 of 12 `/api/shows/[id]/*` routes untested** (deal, capacity, stage, sound/*, settlement/pdf) | Not a prototype — real, but under-tested |
| **`cad-kernel/` (C++23)** | **SCOPE-DECISION** | full CAD engine (A*/Jacobian/Newton-Raphson/geodesy); **zero** app integration; single commit | Out-of-scope orphan. See §3 |

---

## 2. Drift reconciliation — the six `ed0b32e` overclaims (gating for freeze)

Each must be resolved by *either* implementing the claim *or* correcting the narrative. None
is an active runtime bug.

### 2.1 Model swap is config-only — RESOLVED: keep DeepSeek
- **Claim:** "Qwen 2.5 7B Instruct replaces DeepSeek-R1 14B … deployed to Ollama as lari-qwen."
- **Reality:** `lib/ollama.ts:6` still defaults to `lari-the-kitchen-assistant` (DeepSeek). Qwen
  only runs if an operator sets `LARIAT_OLLAMA_MODEL=lari-qwen`.
- **Resolution (2026-05-24):** Ran `eval:assistant-prompt` against both models. On the diagnostic
  Ollama leg (the only leg that tests the actual local model — the exit-code/totals are tallied on
  the hermes/prompt leg, see note): **DeepSeek = 7 PASS / 1 PARTIAL / 2 FAIL**, **Qwen = 1 PASS /
  5 PARTIAL / 4 FAIL** (Qwen fails `scale_recipe` action-JSON T09, and goes PARTIAL on allergen
  escalation T03/T04 and HACCP temp/cooling T05/T06). **Decision: keep DeepSeek as the v2 default;
  do NOT flip.** The "Qwen is superior" claim is contradicted by the eval. Qwen needs more
  fine-tuning before reconsideration.
- **Follow-on (recommended, DEFERRED):** make the eval's Ollama leg an actual gate (today only the
  prompt leg gates exit code), so a weak local model can't be silently shipped. And note: DeepSeek
  itself isn't perfect on this leg (T06/T07 fails) — local-model quality is a real improvement axis.

### 2.2 Entity Phase 2 (UUID FKs) is not implemented
- **Claim:** "Entity layer Phase 2: UUID FK columns + backfill migration."
- **Reality:** only `entities_purchase_orders.vendor_uuid`. The four high-traffic tables lack
  UUID FKs and there is no backfill migration.
- **Decision:** This is genuine multi-table migration work. **Recommend DEFERRED to a real
  Phase 2** (own design + migration + backfill + tests). Correct the narrative now.

### 2.3 Dish coverage snapshots — RESOLVED: wired
- **Claim:** "Dish coverage snapshots: table + lib + management page wired."
- **Was:** `lib/dishCoverageSnapshots.ts` writer never called; `dish_coverage_snapshots` absent
  from `initSchema`; `app/management/page.jsx` computed inline.
- **Resolution (2026-05-24):** option (a) implemented — added `dish_coverage_snapshots` table to
  `initSchema` (`lib/db.ts`, matching the existing `DishCoverageSnapshot` interface); compute engine
  now writes a snapshot after `recomputeMarginAnalysis` (`lib/computeEngine/index.ts` step 2b,
  best-effort try/catch so it can't break the cost/margin/variance critical path); management page
  reads the snapshot first and falls back to inline compute when none exists yet
  (`app/management/page.jsx`). Verified: `test:schema` 55/55, `test:compute-engine` 15/15.

### 2.4 Cloud-bridge pull/status are intentional v1 stubs
- **Claim:** "Cloud bridge: pullSnapshot + status implementation."
- **Reality:** both throw/return-null by design (`CLOUD_BRIDGE_NOT_IMPLEMENTED`); push-first is
  the documented v1 stance.
- **Decision:** **DEFERRED is correct** — just fix the narrative. No code change for v2.

### 2.5 Specials INTEGER→TEXT migration does not exist
- **Claim:** "Specials table: INTEGER→TEXT timestamp migration."
- **Reality:** timestamps are INTEGER as originally designed; no migration.
- **Decision:** Harmless. Correct the narrative; no code change.

### 2.6 SageMaker client orphaned + AWS trainer model mismatch
- **Reality:** `lib/sagemaker.ts` was unwired and is now removed. `training/aws/train_script.py`
  still fine-tunes Llama 3.1 8B while the local pipeline fine-tunes Qwen.
- **Decision:** v2 ships no runtime SageMaker inference path. Keep AWS as DEFERRED cloud-training
  tooling only; align its base model in a future training slice before any production deploy.

---

## 3. Scope decision: `cad-kernel/`

A complete **C++23 CAD engine** (A* pathfinding, Jacobian, Newton-Raphson, geodesy, CRS,
clothoids, BVH, seating layout) lives in the repo with **zero integration** into the Next.js app
— no Node addon, no WASM bridge, no shell-out. The live floor-plan (`Floorplan.jsx`) is hand-drawn
SVG and does not use it. It is one commit (May 9), build artifacts (`build/`, `build2/`) are not
gitignored.

**Recommendation:** Move `cad-kernel/` to its own repo (e.g. `Lariat-CAD` or fold into
`FloorPlanDesigner`) — it does not belong in the restaurant-ops tree and bloats it. Recover from
git history if a future drag-and-drop seating designer needs it. **This needs your call** before
the freeze, since removing/moving it is irreversible-ish and the code represents real effort.

Secondary cleanup (low priority, v2 hygiene): `src/` (empty dir) → remove; `outputs/` → clarify or
`.gitkeep`; `recipes/` → confirm still used by ingest or consolidate; `drive-event-ops-dl/`,
`archive/` → consolidate to an out-of-tree archive.

---

## 4. The v2 freeze line

**Frozen (locked, in scope, do not reopen):** Kitchen Assistant + db_query + Data Pack + prompt
eval · 9/11 HACCP concepts + 422 gate + audit transactionality · breaks/sick-leave/wage-notices/
tip-pool · compute engine · entity Phase 1 · sales depletion Phase 3 · JS↔Python parity · ingest
pipelines + Toast OAuth · multi-instance sync · idempotency · env canonicalization · cloud-bridge
push + DLQ · KDS protocol (tested) · BEO (tested) · live ops · mDNS · desktop/Electron · build
pipeline · floor-plan.

**Fix-before-freeze — status as of 2026-05-24:**
1. ✅ §2.1 Model — evaluated; Qwen fails (1/10 vs DeepSeek 7/10 on the Ollama leg). Kept DeepSeek.
2. ✅ §2.3 Dish coverage — wired (table + compute-engine writer + management read). Tests green.
3. ✅ §2.6 SageMaker — removed the unwired runtime inference client; AWS remains deferred
   cloud-training tooling. AWS-trainer/Qwen base-model divergence documented.
4. ✅ date-marks rule test — already exists as `tests/js/test-date-mark-rules.mjs` (25 tests, green);
   the audit "gap" was a false positive (searched the plural filename). No action needed.
5. ✅ calibrations route — **documented exception, NOT rename.** The route works and is
   fully tested (`test-calibrations-api.mjs`); renaming `app/api/thermometer-calibrations/` →
   `app/api/calibrations/` touches the API contract, 2 UI fetch calls, the PIN-gate list, and 4
   test files. Cosmetic conformance at real risk; keep the exception.
6. ⏳ Reconcile `ed0b32e` narrative in docs — V2_FREEZE_PLAN (this file) + memory now capture all
   six overclaims. CLAUDE.md's model section is still accurate (DeepSeek stays default). No further
   doc edit strictly required; this file is the canonical reconciliation.

**Deferred (explicitly out of v2):** entity Phase 2 UUID FKs · cloud-bridge pull/status · 7shifts
backoff · Prism (blocked on external spec) · shows route tests (9) · `@ts-nocheck` migration (256
files, touch-on-edit) · mDNS unit tests · UI v2 migration · Roadmap Tier 2/3.

**Scope-decision (your call):** `cad-kernel/` move-out · `certs` regulated-or-informational ·
shows/venue arm test-harden priority · whether Qwen is the v2 model.

---

## 5. Open product decisions (carried from PROJECT_ROADMAP.md, still open)

| Decision | Blocks |
|----------|--------|
| Is Qwen 2.5 7B the v2 production model? | §2.1 — flip default + re-baseline eval |
| Is the live-music venue arm actively used? | shows route-test investment |
| `cad-kernel/` — keep in-tree, move, or delete? | §3 |
| Multi-venue or single-venue target shape? | Roadmap 3.1 |
| Is `labor/certs` regulated or informational? | HACCP 5-file exception |

---

## 6. Recommended freeze sequence

1. **Decide** §2.1 (model) and §3 (cad-kernel) — these are the only two that need *you*, not code.
2. **One docs commit** reconciling all six overclaims (§2.1–2.6) + CLAUDE.md/OPERATIONS.md.
3. **One small feature commit** finishing dish-coverage (§2.3) — table + wire + read.
4. **One hygiene commit** — complete; date-marks test was present (§4.4), calibrations is a
   documented exception (§4.5), and the SageMaker runtime client was removed (§2.6).
5. **Re-run gates** (`test:rules`, `test:schema`, `test:datapack`, `test:compute-engine`,
   `eval:assistant-prompt`) — confirm green.
6. **Tag the freeze.** Everything in "Deferred" becomes the v2.1 backlog.

That is ~1–2 focused days of work plus two product decisions. Nothing in the frozen set needs
to be reopened.
