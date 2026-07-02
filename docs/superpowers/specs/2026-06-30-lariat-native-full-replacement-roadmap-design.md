# Lariat → Native: Full-Replacement Roadmap (design)

**Date:** 2026-06-30
**Status:** Approved shape; per-phase implementation plans to follow via `writing-plans`.
**Owner:** Sean Burdges

## North star

One native Swift app (macOS + iPad) becomes the daily driver for everything
staff, managers, and cooks do in Lariat. A **thin Next.js "edge" server**
survives only for surfaces that physically cannot be native — guest-facing
BEO share-and-sign links, PWA / remote browser access — plus any hard blockers
that surface during the port. The operating rule, in the user's words:

> *Anything that can be absorbed into Swift, is. What genuinely can't, stays Next.js.*

This is a **full replacement** of the operator-facing product, executed in
phases, ending in a consolidation that retires the scattered duplicate copies
of Lariat across the user's drives.

## Architecture

- **Swift-maximal.** `LariatNative` (SwiftPM: `LariatModel` / `LariatDB` /
  `LariatApp`) absorbs UI, business logic, and eventually schema ownership.
- **Next.js-residual.** The web app shrinks to an edge server hosting only the
  guest/remote surfaces that require a public URL. It is **not** deleted.
- **Shared SQLite (`data/lariat.db`).** Until Phase C, the web app remains the
  system of record (owns schema + migrations); `LariatNative` reads it and
  performs **audited writes** through the existing invariant contracts.

### What already exists (do not rebuild)

- GRDB read layer (`LariatDatabase`, read-only default) + audited-write layer
  (`LariatWriteDatabase`, `AuditedWriteRunner`, `AuditEventWriter`).
- Invariant contracts: `AuditedWrite` (in-tx `audit_events`), `RuleGate`
  (422 corrective-note), `PinGate` / `TempPinVerifier`.
- The `NavigationSplitView` shell, manager read-tier, and partial cook/safety
  tiers (P0–P3b).
- The **`swift-port` agent** (`.claude/agents/swift-port.md`) — proven by the
  `food-safety/cooling` pilot: scope-clean, build + 260 tests green, constants
  matching `lib/cooling.ts` exactly (branch `feat/native-cooling-board`).

### The gap

The web app is ~95 page routes across 36 feature areas + ~130 API routes.
Native covers roughly a quarter. The remainder is enumerated in Phase A.

## Unit of work

Every feature area is ported by **one `swift-port` agent**:

1. Read the web feature (route + `app/api/**` + `lib/**` + `tests/js/**`) — the spec.
2. Port in layers, TDD at each: `LariatModel` (Records + `Compute/` parity ports)
   → `LariatDB` (repository; read-only default, audited writes) → `LariatApp`
   (SwiftUI view + `@Observable` view model, registered in the shell).
3. Verify `swift build` + `swift test`; commit in an isolated worktree; never
   edit the web app or `data/lariat.db`; never auto-merge.
4. Return a parity report; the orchestrator verifies scope + re-runs gates +
   integrates serially.

## Phases

### Phase A — Finish the in-house operator tier *(read + audited-write over existing DB)*

Web app stays system-of-record. **Decision: maximum parallelism** — fan out as
many independent feature areas at once as the concurrency cap allows, integrate
continuously. Groups (each area is one `swift-port` task):

- **A0 Feature self-registration (prerequisite — must land first).** Refactor the
  shell to a `FeatureModule` / `FeatureRegistry` pattern so a port adds its own
  file + one array append instead of editing the `detailView` switch, the
  destination enums, and the hub views. Without this, max parallelism fights the
  shared shell files on every integration. Design + rationale in
  `2026-06-30-lariat-native-risk-mitigations.md` (Risk 1).
- **A1 Food-safety** — cooling ✓; sanitizer, tphc, pest, sds, sick-worker,
  receiving, haccp-plan.
- **A2 Cook line** — station line-checks detail, prep + fire-schedule + par,
  morning, command (full), playbook, full 86, full KDS.
- **A3 Labor** — breaks (partial ✓), certs, sick-leave, tip-pool, wage-notices.
- **A4 Costing / menu-engineering / purchasing / inventory** — the README
  "not ported" gaps (`dishCostBridge`, `listMarginDeltas`, `computeCostVariance`,
  full depletion resolver) + inventory counts/par/waste/log, purchasing
  compare/link, menu-engineering components/margin-deltas.
- **A5 Management writes** — audit-log, pins, temp-pins, receiving-matches,
  peers, cloud-bridge UI (performance-reviews ✓).
- **A6 FOH + events** — host, floor, reservations, booking, bar, equipment,
  specials, allergen-lookup, datapack-search, gold-stars, and shows/*
  (box-office, settlement, sound, stage).

**Exit criteria:** every operator-facing web screen has a native equivalent at
behavior parity (rules + audited writes), build + tests green.

### Phase B — Kitchen-assistant (LLM)

Port the assistant to a Swift client calling the model directly (current
DeepSeek/Ollama setup). Citations, datapack search, and conversation memory
ported with parity tests.

### Phase C — Schema-ownership inversion *(the backend rewrite)*

Flip `LariatNative` from reader to **system of record**: own the schema +
migrations + the write-side business rules currently in the ~130 API routes.
Deliberately sequenced **after** Phase A so the DB is not destabilized while
screens are still being ported. **Gets its own dedicated sub-spec** — highest-risk
phase.

### Phase D — Reduce Next.js to the edge

Strip the web app to only the residual surfaces (guest share-and-sign, PWA,
documented blockers). Everything else removed from the web codebase.

### Phase E — Cutover + consolidation / delete

The user's end goal: retire the scattered duplicate copies. Executed only after
A–D, with rails:

- Establish the **one canonical location** (Swift app + residual edge server + data).
- **Safety rail — load-bearing paths are relocated/absorbed first and removed
  from the delete set, never deleted blind:** `~/Dev/hospitality/Lariat`,
  `…/LariatNative`, `…/Lariat-KDS`, and `~/Dev/lariat-data-sources` (real PII).
- Verified backup → delete only confirmed duplicates → reversible, per-step
  checklist with explicit user confirmation at each destructive step.

## Cross-cutting decisions & risks

Detailed mitigations: `2026-06-30-lariat-native-risk-mitigations.md`.

- **Integration bottleneck (Risk 1).** Every new screen currently edits four
  shared shell spots (incl. a `detailView` switch case — the worst kind of merge
  conflict). **Mitigated by Task A0** (feature self-registration), which drops
  per-feature shared edits to a single array append before the max-parallel wave.
- **`actor_source` divergence (Risk 3).** Web emits a 16-value surface taxonomy;
  native collapses to `native_cook`/`native_mac`. A shared canonical `ActorSource`
  enum is standardized in Phase C; ports keep the native convention until then.
- **Schema inversion (Risk 2).** Phase C gets its own sub-spec (migration handoff,
  dual-write shadow period, rule inventory, rollback, integrity parity tests).
- **Blocker log (Risk 4).** Each "can't-go-native" surface is appended to
  `lariat-native-edge-blockers.md` (the Phase D scope) rather than forced into Swift.
- **Tooling hygiene.** `eslint.config.js` now ignores `.claude/**` so agent
  worktrees don't trip the commit gate (fixed in `eeafd1d`).

## Out of scope (explicit)

- Rebuilding anything listed under "What already exists."
- Deleting any path before Phase E, and any load-bearing path ever (relocate first).
- Schema/migration changes during Phase A (read against existing schema only).
- The guest BEO e-sign workflow change (kept on the edge server, not re-natived).

## Next step

1. **Task A0** — implement the feature self-registration pattern (Risk 1
   mitigation) and update the `swift-port` agent to register via it; re-base the
   cooling pilot onto the registry.
2. Write the **Phase A1 (food-safety wave)** implementation plan via
   `writing-plans`, then dispatch the wave (max parallel) under the coordinator
   pattern.
