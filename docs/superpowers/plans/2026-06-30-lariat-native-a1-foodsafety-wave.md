# Phase A1 — Food-Safety Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. Each task is a single `swift-port` agent dispatch (the agent runs its own internal TDD per `.claude/agents/swift-port.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port the remaining food-safety boards from the Next.js app into `LariatNative` at behavior parity, registered via the A0 self-registration pattern.

**Architecture:** One `swift-port` agent per board, each in its own worktree based on `feat/lariat-native-port` (which has A0 + cooling). Agents work fully in parallel (max parallelism); the dispatcher verifies each and integrates **serially**. After A0 the only shared-file touch per board is a one-line append to `FeatureCatalog.all` and to `FeatureRegistry.all` — append conflicts, mechanically resolvable.

**Tech Stack:** Swift 6.4 / SwiftUI / GRDB; web spec in `app/food-safety/**` + `app/api/**` + `lib/**` + `tests/js/**`.

## Global Constraints

- Port against the **existing** `lariat.db` schema (read `lib/db.ts`); **no migrations**, no `CREATE TABLE` changes.
- Every regulated write emits an `audit_events` row **in the same transaction** as the source write (`AuditedWriteRunner`/`AuditEventWriter`); match the web route's status codes (e.g. 422 corrective-note via `RuleGate`, 409 double-action, 404 cross-location IDOR).
- `actor_source` keeps the native convention (`native_cook`) for this wave; canonical-taxonomy standardization is deferred to Phase C (see risk-mitigations doc).
- Registration is A0-style: a new `<Board>Feature` `FeatureModule` (in `SafetyFeatures.swift` or its own file) + one `FeatureDescriptor` in `FeatureCatalog.all` + one append to `FeatureRegistry.all`. **Do NOT edit `LariatApp.swift` or `FoodSafetyHubView.swift`** (generic after A0).
- Touch only `LariatNative/`. Never edit the web app or `data/lariat.db`. No push/rebase/merge — the dispatcher integrates.
- Per-board acceptance: from `LariatNative/`, `swift build` + `swift test` green, including new `*ComputeTests` + `*RepositoryTests` whose cases derive from the named web test(s).

---

## Board task table (the spec for each agent)

| Task | Board | Web page | API route | lib rule module | Parity test source | Native id | Notes |
|---|---|---|---|---|---|---|---|
| T1 | sanitizer | `app/food-safety/sanitizer/SanitizerBoard.jsx` | `app/api/sanitizer/route.ts` | `lib/sanitizer.ts` | `tests/js/test-sanitizer-rules.mjs`, `test-sanitizer-api.mjs` | `safety.sanitizer` | concentration ppm thresholds by sanitizer type |
| T2 | tphc | `app/food-safety/tphc/TphcBoard.jsx` | `app/api/tphc/route.js` | `lib/tphc.ts` | `test-tphc-rules.mjs`, `test-tphc-api.mjs`, `test-tphc-patch-idor.mjs` | `safety.tphc` | 4-hour time-as-public-health-control discard; **port the PATCH IDOR 404 guard** |
| T3 | pest | `app/food-safety/pest/PestBoard.jsx` | `app/api/pest/route.ts` | `lib/pestControl.ts` | `test-pest-rules.mjs`, `test-pest-citation.mjs`, `test-pest-api.mjs` | `safety.pest` | citations must port verbatim (`test-pest-citation`) |
| T4 | sds | `app/food-safety/sds/SdsBoard.jsx` | `app/api/sds/route.ts` | `lib/sds.ts` | `test-sds-rules.mjs`, `test-sds-api.mjs` | `safety.sds` | safety-data-sheet registry |
| T5 | sick-worker | `app/food-safety/sick-worker/SickWorkerBoard.jsx` | `app/api/sick-worker/route.js` | `lib/sickWorker.ts`, `lib/sickWorkerGate.ts` | `tests/js/test-sick-worker-rules.mjs` (run via `npm run test:sick-worker`) | `safety.sickWorker` | FDA Big-6 exclusion/restriction gate; port `sickWorkerGate` logic faithfully |
| T6 | receiving | `app/food-safety/receiving/ReceivingBoard.jsx` | `app/api/receiving/route.js` **only** | `lib/receiving.ts` | `test-receiving-rules.mjs`, `test-receiving-api.mjs` | `safety.receiving` | **scope = the receiving temp-check board only.** `app/api/receiving/matches/**` is management tier (A5) — do NOT port here |
| T7 | haccp-plan | `app/food-safety/haccp-plan/page.jsx` (no Board component) | `app/api/food-safety/haccp-plan/route.js` | `lib/haccpPlan.ts` | none | `safety.haccpPlan` | **Different shape** — likely a read-mostly plan-document view, not a regulated-write log. Agent must assess first (see T7). |

---

### Task T1–T6: regulated-write boards (sanitizer, tphc, pest, sds, sick-worker, receiving)

Each is an independent `swift-port` dispatch following the proven cooling/temp-log recipe. Mirror the cooling port (`LariatNative/Sources/.../Cooling*.swift`) and the temp-log template.

- [ ] **Step 1: Create the worktree** (dispatcher) — `git worktree add worktrees/native-<board> -b feat/native-<board> feat/lariat-native-port` and symlink node_modules: `ln -sfn <repo>/node_modules worktrees/native-<board>/node_modules`.
- [ ] **Step 2: Dispatch the `swift-port` agent** with the row's web sources as the spec, the native id, and a scope contract (MAY modify the board's new `LariatModel`/`LariatDB`/`LariatApp` files + `SafetyFeatures.swift` + `FeatureCatalog.swift` + `FeatureRegistry.swift`; MUST NOT touch the web app, other features, `LariatApp.swift`, `FoodSafetyHubView.swift`, `Package.swift`, or migrations).
- [ ] **Step 3: Agent ports** — `LariatModel` Records + `Compute/` parity port (value tests first from the named web test) → `LariatDB` repository (in-memory GRDB fixture tests first) → `LariatApp` View+ViewModel + A0 registration. `swift build` + `swift test` green.
- [ ] **Step 4: Verify (dispatcher)** — re-run `swift build` + `swift test` in the worktree; `git diff` shows only the board's `LariatNative/` files + the two registry appends; spot-check the ported thresholds/citations against the lib module.
- [ ] **Step 5: Integrate serially** — merge `feat/native-<board>` into `feat/lariat-native-port`, resolving the `FeatureCatalog.all` / `FeatureRegistry.all` append conflicts (keep all entries). Re-run `swift build` + `swift test` on the integration branch. Commit the merge.

### Task T7: haccp-plan (assess-first)

- [ ] **Step 1: Assess** — dispatch a `swift-port` agent to first read `app/food-safety/haccp-plan/page.jsx`, `app/api/food-safety/haccp-plan/route.js`, and `lib/haccpPlan.ts` and report: is this a **read-only plan-document view** or does it have **regulated writes**?
- [ ] **Step 2: Port to its actual shape** — if read-only, port a read-only `HaccpPlanView` + repository (no audited-write path, no RuleGate); if it has writes, follow the T1–T6 recipe. Register via A0 (`safety.haccpPlan`).
- [ ] **Step 3: Verify + integrate** as in T1–T6 Steps 4–5. If the assessment shows it is purely static/derived with no native value yet, **defer it** and note that in the wave report rather than porting a stub.

### Final integration gate

- [ ] After all tasks integrate into `feat/lariat-native-port`: `swift build` + `swift test` green; the Safety sidebar lists all boards; each new board reachable via its `safety.<id>`; `FeatureRegistryTests` still pass. Report the wave parity summary (per-board: covered vs deferred).

---

## Self-review notes

- **Spec coverage:** all seven food-safety routes from the roadmap A1 list have a task. receiving/matches explicitly routed to A5 (not dropped — scoped out with a pointer).
- **Shape risks called out:** haccp-plan (no tests, no Board component) is assess-first, not assumed to be a write board; sick-worker tests run via the `test:sick-worker` npm script (not a bare `tests/js` glob).
- **Parallelism honesty:** after A0 the only shared edits are two one-line appends per board; integration is serial to resolve them. This is the documented max-parallel + serial-integrate model, not a claim of zero-conflict.
