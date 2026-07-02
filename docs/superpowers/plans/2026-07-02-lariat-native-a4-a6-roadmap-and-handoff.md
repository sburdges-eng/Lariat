# LariatNative — A4 / A5 / A6 Roadmap & Session Handoff

> **Purpose.** This is the pick-up-and-continue document for finishing the LariatNative
> Swift-macOS port. It captures the north-star goal, the current merged state, the porting
> pattern that works, the operational gotchas that will bite you, and per-group plans for the
> three remaining Phase-A groups (A4 costing/inventory/purchasing, A5 management writes,
> A6 FOH+events). Each group decomposes into per-board waves; **each wave still starts with a
> gap-audit** (there is no shortcut around reading the web source of truth).

---

## 0. Handoff at a glance

- **Goal:** every operator-facing web screen has a native (SwiftUI + GRDB) equivalent at *behavior*
  parity (rules + audited writes), so the ~100 duplicate Lariat directories can be consolidated and
  deleted. A thin Next.js "edge" survives only for surfaces that genuinely can't go native.
- **Merged to `main` (2026-07-02):** the foundation (#379) + A3 Labor (#381). Display-polish is
  **PR #382 (open)**. Whole native suite ≈ **898 tests, 0 failures**.
- **Done:** cooling · A0 self-registration · A1 (7 safety boards) · A2 (3 cook ports) · regulatory
  L5/L6 signoff gates · Command margin-moves · KDS bump · A3 Labor (certs/sick-leave/tip-pool/
  wage-notices) · display polish (86 row-meta, Command traffic-lights + events/reservations tiles,
  stations par/have/need + gloves).
- **Remaining Phase A:** **A4**, **A5**, **A6** (this doc). Then Phase B (LLM), C (schema inversion),
  D (reduce Next.js to edge), E (cutover + delete — load-bearing paths relocated first).
- **⚠️ Biggest operational risk right now:** the `swift-port` subagent infrastructure was dropping/
  stalling repeatedly on 2026-07-01→02 (5 consecutive failures during A3). Recovery worked (agents
  produce the parity-critical compute/repo before dropping; finish by hand), but **plan for
  hand-authoring until it recovers.** See §4.

---

## 1. Goal & strategy (north star)

Build the LariatNative Swift macOS app to full behavior parity with the Next.js cockpit. Decisions
already made (do not relitigate without the user):

- **Full replacement.** Swift absorbs everything it can. The Next.js app is reduced to a thin edge
  server only for surfaces that can't be native — logged in `docs/superpowers/specs/lariat-native-edge-blockers.md`
  (seeded: guest BEO e-sign share/sign links, PWA/remote browser).
- **UI first, invert schema later.** Native reads the web-owned shared `data/lariat.db`. **No native
  migrations** — the web app owns the schema; native is a read-mostly consumer + audited writer.
  Schema inversion is Phase C (its own high-risk sub-spec).
- **Deletion is deferred to Phase E.** The user's ~100-path delete list includes load-bearing paths
  (`~/Dev/hospitality/Lariat` canonical repo, `.../LariatNative`, `.../Lariat-KDS`,
  `~/Dev/lariat-data-sources` = real PII). NOTHING is deleted until those are relocated/absorbed and
  removed from the delete set. See memory `[[lariat-data-corpus]]`.

Roadmap/risk specs: `docs/superpowers/specs/2026-06-30-lariat-native-full-replacement-roadmap-design.md`,
`.../2026-06-30-lariat-native-risk-mitigations.md`.

---

## 2. Current state

**Branch topology.** `main` now contains the foundation + A3. Native work is done on feature branches
off `main`, one per wave, each → its own PR. The dev worktree is `worktrees/native-port` (a git
worktree; `node_modules` is symlinked into it so the commit gate's lint/typecheck can run —
`ln -sfn <repo>/node_modules worktrees/native-port/node_modules`).

**Native module inventory (already built — do NOT re-port):**
- **Targets:** `LariatModel` (pure `Compute/` + Records + invariant contracts), `LariatDB` (GRDB
  repositories), `LariatApp` (SwiftUI + A0 self-registration shell).
- **Compute (30):** Analytics, Break, Calibration, Cleaning, Command, Cooling, Costing, DateMark,
  HaccpPlan, MarginDeltas, MinorRestrictions, Morning, PerformanceReview, Pest, Prep, PrepPar, Probe,
  Receiving, RollupTileColor, Sanitizer, Sds, SickLeave, SickWorker, StaffCert, StationProgress,
  SubRecipeCascade, TempLog, TipPool, Tphc, WageNotice.
- **Repositories (31):** Analytics, Break, Calibration, Cleaning, Command, Cooling, **Costing**,
  DateMark, EightySix, HaccpPlan, KdsTicket, LineCheck, **ManagementRollup**, MarginDeltas, Morning,
  **PackChanges**, PerformanceReviews, Pest, PrepPar, Prep, **Receiving**, Sanitizer, Sds, SickLeave,
  SickWorker, StaffCert, TempLog, TipPool, TodayBoard, Tphc, WageNotice.
- **Registered features (29):** cook (7), safety (14), labor (4), manager (4: command, analytics,
  **costing**, management).

**Invariant contracts (reuse — don't reinvent):** `AuditedWriteRunner` + `AuditEventWriter` +
`AuditEventInput` (in-transaction `audit_events`, `payloadJSON`/`note` variants); `RegulatedWriteContext`
(`.nativeCook` / `.nativeMac`); `PinSessionStore` / `PinVerifier` / `TempPinVerifier` / `ManagerPinUser`
/ `ManagementWrite.requireSession` / `PinEntrySheet` (PIN gates); `RuleGate` (422 corrective-note);
`WriteErrorMapper`; `StaffCatalog`; `StationCatalog`; `ShiftDate`; `LocationScope`; `Money`; `TileDegrade`.

---

## 3. The proven porting pattern (the recipe that works)

Every board is the same vertical. Follow it:

1. **`LariatModel/Compute/<X>Compute.swift`** — a *pure* port of the web `lib/<x>.ts` rule module
   (validation, math, thresholds). No GRDB, no I/O. Enums used inside a `Codable` row **must**
   declare `Codable` (learned the hard way — `TipKind`/`WageNoticeReason`).
2. **`LariatModel/<X>Records.swift`** — GRDB `FetchableRecord` row(s) (snake_case `CodingKeys`
   matching the web schema), input structs, a `<X>WriteError` enum, result/snapshot types. Money is
   **`Int` cents**, never `Double` dollars.
3. **`LariatDB/<X>Repository.swift`** — open reads via `readDB.pool.read`; audited writes via
   `AuditedWriteRunner.perform { db in … AuditEventWriter.post(...) }` (mutation + audit in ONE
   transaction; a rule failure throws BEFORE the audit write so a 422-equivalent leaves no row + no
   audit). `actor_source = native_mac` for manager writes / `native_cook` for cook writes.
4. **`LariatApp/<X>View.swift` + `<X>ViewModel.swift`** — SwiftUI board; reads poll every 3–5 s
   (ValueObservation can't see cross-process writes); per-write PIN gate via `ManagementWrite`/
   `PinSessionStore`/`PinEntrySheet` for payroll/PIC-sensitive writes; dollars→cents via `Decimal`.
5. **A0 self-registration** — one `FeatureDescriptor(id:tier:title:)` in `FeatureCatalog.all`, one
   `FeatureModule` in the tier's `*Features.swift` (`writeDatabase` guard → view, else `TileDegrade`),
   one line in `FeatureRegistry.all`, one assertion in `FeatureRegistryTests`. **Never edit
   `LariatApp.swift` or the hub views** — the registry is the only wiring.
6. **Tests (TDD).** `<X>ComputeTests` (pure, against the rules oracle) + `<X>RepositoryTests` (seeded
   in-memory GRDB fixture that CREATEs the tables the repo reads + `audit_events`; **no native
   migration** — mirror an existing `seed*Database` helper). The parity oracle is the web
   `tests/js/test-<x>-*.mjs`; **port every case**. If the web board has NO test (e.g. certs), author
   native tests against the route/board CODE.

**Divergences that are deliberate (assert the native value in tests, don't "fix"):**
`actor_source = native_mac`/`native_cook` (web uses `pic_ui`/`cook_ui`/`api` — standardize in Phase C);
no idempotency layer (native has no HTTP/replay surface — document as deferred); package-wide
`Sendable` warnings on repositories (pre-existing convention).

---

## 4. Operational gotchas — READ before resuming

1. **`swift-port` agent infra was down (2026-07-01→02).** Five consecutive runs dropped
   ("connection closed mid-response") or stalled (watchdog 600s). **Recovery pattern that worked:**
   the agent reliably writes the parity-critical `Compute`/`Records`/`Repository` + compute-tests
   before dropping; those are hand-verifiable against the web oracle in minutes; then the lead finishes
   the repo-tests + view/VM + A0 registration + build/commit by hand. If dispatching, tell the agent
   to **write compute+records+repo+compute-tests FIRST** so a drop leaves the valuable work on disk.
   If it drops with nothing, hand-author (display polish + L4 wage-notices were 100% hand-authored and
   went fine). Re-check availability before assuming; it may have recovered.
2. **Stacked-PR merge trap.** A3 was PR #380 stacked on #379 (base = `feat/lariat-native-port`).
   Merging #379 with `--delete-branch` deleted the base and **auto-CLOSED #380** (GitHub closes a
   child whose base branch is deleted; it does not always retarget). Recovery: reopen as a fresh PR
   to `main` (#381). **Rule:** retarget a stacked child to `main` BEFORE merging its base, or expect
   to reopen. Use **merge-commits** (`gh pr merge --merge`) not squash for stacked bases (squash
   rewrites history and breaks the child).
3. **Commit gate.** A git pre-commit hook + a Claude PreToolUse Bash hook run `npm run lint` +
   `npm run typecheck` (and check-session-branch) on every `git commit`. Swift-only commits pass
   (lint-staged: "no matching files"; tsc: no TS changed). **Never `--no-verify`.** The worktree needs
   the `node_modules` symlink for this to run.
4. **GitNexus.** Index refreshed 2026-07-02 (`node .gitnexus/run.cjs analyze` from the canonical repo
   root — the worktree lacks `run.cjs`). A recurring "index stale" banner fires on feature-branch
   worktrees comparing HEAD to the indexed commit — it's noise once you've analyzed. The graph is
   web-focused; native symbols often return "not found" from `impact()`, so impact-analysis on new
   native files is low-signal (they're additive; no existing-symbol edits).
5. **Concurrency.** Other sessions share the tree (stashes exist for `p3-audited-write`,
   `v2-freeze-closeout`, a LaRi prompt refactor). The canonical repo is usually on someone else's
   branch — **do not checkout `main` there or disturb their stashes.** Work in `worktrees/native-port`.
   Always `git status` before commit/branch ops.
6. **⚠️ Web glove-change (F15) is in flux.** A stashed WIP on `v2-freeze-closeout` is *removing*
   glove-change attestation from web `/api/checks` (currently INCOMPLETE/broken). Native stations
   mirrors *current main* (glove toggle present). If web removes F15, revisit the native stations
   glove UI + the `LineCheckPostInput.gloveChangeAttested` path to stay in parity.
7. **Verification discipline.** Re-run `swift build && swift test` yourself before accepting any
   agent's "green" claim, and `git diff --name-status <base> HEAD` to confirm scope. Read the full
   web oracle before porting; don't trust a summary for money/date/compliance math.

---

## 5. A4 — Costing / menu-engineering / purchasing / inventory

**Web surfaces:** `app/costing/{prices, price-shocks, ingredient-masters, pack-changes,
depletion-exceptions, variance-attribution, _components}`, `app/menu-engineering/{margin-deltas,
components}`, `app/purchasing/{compare, link}`, `app/inventory/{counts, par, waste, log, InventoryBoard}`.
**Libs:** `dishCostBridge.ts`, `varianceAttribution.ts`, `varianceTrend.ts`, `depletionExceptions.ts`,
`salesDepletion.ts`, `menuEngineering.ts`, `inventoryShrinkage.ts`, `bomVendorProposals.ts`,
`vendorCompare.ts`, `vendorMapping(Repo).ts`, `vendorPricesRepo.ts`, `costingBenchmarks.mjs`.
**Parity oracles:** ~29 `tests/js/test-*` files (cost/inventory/purchasing/depletion/variance/menu-eng/
vendor/shrinkage). Money-heavy — **integer cents, exact rounding, no implicit unit conversion.**

**Already native (extend, don't re-port):** `CostingCompute` + `CostingRepository` + `Costing` view
(manager.costing aggregate); `MarginDeltasCompute`+`MarginDeltasRepository` (listMarginDeltas ✓);
`PackChangesRepository`+`PackChanges` view; `ReceivingCompute`+`ReceivingRepository`+`Receiving` view;
`ManagementRollupRepository.loadPriceShocks` (price-shocks summary). The README "not ported" gaps
`dishCostBridge` / `computeCostVariance` / full depletion resolver are the core remaining compute.

**Suggested waves (gap-audit each first):**
- **A4.1 Inventory** (greenfield): `inventory.counts` / `inventory.par` / `inventory.waste` /
  `inventory.log` — read boards + audited count/adjust writes. New `.inventory` tier or under manager.
- **A4.2 Costing detail boards:** `costing.prices`, `costing.priceShocks` (promote the rollup summary
  to a full board), `costing.ingredientMasters`, `costing.depletionExceptions` (full resolver:
  recipe_missing_yield / cross_dim_unit_mismatch / invalid_qty — currently only `no_dish_components`),
  `costing.varianceAttribution` (`computeCostVariance` + `varianceTrend`).
- **A4.3 Menu-engineering:** `menuEngineering.ts` quadrant/margin math (partly in `CostingCompute` —
  audit overlap) + the margin-deltas detail view (compute already ported).
- **A4.4 Purchasing:** `purchasing.compare` (`vendorCompare`), `purchasing.link` (`vendorMapping`) —
  audited vendor-mapping writes.

**Risks:** money rounding (mirror the asymmetric/half-away conventions already used in TipPool/Margin);
`dishCostBridge` unit handling ("no implicit conversion" posture); depletion resolver is subtle
(multiple exception reasons); vendor-mapping writes are audited. Tier decision: a new `.costing`/
`.inventory` tier vs. more `manager.*` — user's call (like the `.labor` decision).

---

## 6. A5 — Management writes

**Web surfaces:** `app/management/{audit-log, pins, temp-pins, receiving-matches, peers, cloud-bridge,
performance-reviews, _components}`, `app/admin/{cleaning-schedule, service-hours}`.
**Libs:** `auditEvents.ts`, `auditLog.mjs`, `pin.ts`/`managerPins.ts`/`pinCookie.ts`,
`tempPin.ts`/`tempPinCookie.ts`, `receiving.ts`, `peers.ts`/`peerTrust.ts`/`peerKeypair.ts`,
`cloudBridge*.ts` (push/queue/replay/drainer/routeGuards), `syncFeed.ts`/`syncApply.ts`/`syncClient.ts`.
**Parity oracles:** ~56 `tests/js/test-*` (pin/audit/peer/receiving/cloud/sync/management). **Security-
sensitive** — PIN hashing, audit-trail integrity, cross-host trust.

**Already native:** `ManagementRollupRepository` + `ManagementRollup` view (manager.management);
`PerformanceReviews` (✓); the PIN primitive stack (`PinVerifier`/`TempPinVerifier`/`PinSessionStore`/
`ManagerPinUser`) is built and used by the labor boards; `AuditEventWriter` (the write side of audit).

**Suggested waves:**
- **A5.1 Audit-log viewer** (read-only, high value): `management.auditLog` — paginated `audit_events`
  reader with entity/action/actor filters. Low risk (read-only), surfaces the trail native already writes.
- **A5.2 PIN management:** `management.pins` (set/rotate manager PIN) + `management.tempPins`
  (issue scoped, time-boxed temp PINs — `lib/tempPin.ts`). Security-critical: SHA-256, never store raw,
  fail-closed. The verifier side exists; this adds the *management/issuance* side.
- **A5.3 Receiving-matches:** `management.receivingMatches` (`receiving.ts`) — audited match writes
  (ReceivingRepository partly exists; audit overlap).
- **A5.4 Peers + cloud-bridge (HARD — likely partial / edge-blocker candidate):** `peers`/`peerTrust`/
  `peerKeypair` (cross-host trust, keypairs) and `cloudBridge*` (push/queue/replay). These are the
  cross-host **sync** layer — native has no HTTP layer, and the sync-feed was explicitly *not* ported
  (see the KDS/stations audits). **Decision needed:** does cross-host sync stay Next.js edge (log to
  `edge-blockers.md`), or does native grow a sync client? Likely **edge** for now — port only the
  read/status UI, leave the transport to the edge server.

**Risks:** PIN/crypto parity must be byte-exact (CryptoKit SHA-256 = Node `createHash`); audit-log
reader must not mutate; cloud-bridge/peers are the most likely A-phase items to land in the edge server
rather than native.

---

## 7. A6 — FOH + events + shows (entirely greenfield)

**Web surfaces:** `app/{host, floor, reservations, booking, bar, equipment, specials, allergen-lookup,
datapack-search, gold-stars}`, `app/shows/{[id], tonight, archive}`, and events via `app/beo/*`.
**Libs:** `hostStand.ts`, `allergenAttestations.ts`, `datapackSearch.ts`, `specials{Export,Promotion,
Validators}.ts`, `showStatus.ts`/`showsRepo.ts`/`showsTonight.ts`, `boxOfficeRepo.ts`,
`settlement{Repo,Print}.ts`, `beo{Cascade,Courses,FireSchedule,PrepHistory,Share}.ts`.
**Parity oracles:** ~57 `tests/js/test-*` (reservations/floor/host/bar/shows/specials/allergen/beo/booking).
**Nothing is native yet** — this is the largest group.

**Suggested waves:**
- **A6.1 FOH floor/host/reservations:** `floor` (dining_tables — the Command tile already reads them),
  `host`/`hostStand`, `reservations`, `booking`. Audited seating/reservation writes.
- **A6.2 Bar + equipment + gold-stars:** smaller boards; `bar`, `equipment`, `gold-stars` (recognition).
- **A6.3 Specials + allergen + datapack:** `specials` (promotion/export/validators — publishing rules),
  **`allergen-lookup` + `allergenAttestations` (SAFETY-sensitive — treat like a food-safety board;
  attestations are audited)**, `datapack-search` (read/search).
- **A6.4 Shows (box-office / settlement / stage / sound):** `shows/{[id],tonight,archive}`,
  `boxOfficeRepo`, `settlementRepo`+`settlementPrint` (**money — integer cents, settlement math**),
  `showStatus`. A self-contained sub-domain; could be its own tier.
- **A6.5 Events / BEO:** `beoCascade`/`beoCourses`/`beoFireSchedule`/`beoPrepHistory` are portable
  (native BeoBoard-adjacent), **but `beoShare` (guest e-sign share/sign links) is an EDGE BLOCKER**
  (already logged) — the guest-facing signable link stays Next.js. Port the internal BEO management +
  fire schedule; leave guest share/sign to the edge.

**Risks:** biggest surface area; allergen attestations are safety-critical (audited, exact); settlement
is money; BEO guest e-sign is a confirmed edge blocker (don't try to go native). Almost certainly a new
`.foh` and/or `.events`/`.shows` tier(s).

---

## 8. Execution recipe per wave

1. **Branch:** in `worktrees/native-port`, `git fetch origin && git checkout -b feat/lariat-native-<wave> origin/main`.
   Confirm the `node_modules` symlink is intact.
2. **Gap-audit** the wave's surfaces (read-only): for each board, read `app/<route>/*`, `app/api/<route>/route.*`,
   `lib/<module>.ts`, the schema in `lib/db.ts`, and `tests/js/test-<x>-*.mjs`; check native for existing
   coverage. Produce a per-board port scope (compute/repo/view + oracle + invariants + risks). Fan out
   read-only agents **if infra is up**; otherwise inventory by hand (the A3 audits are the template).
3. **Plan:** write `docs/superpowers/plans/YYYY-MM-DD-lariat-native-<wave>.md` (per-board tasks, the
   Global-Constraints block, the money/date/compliance specifics, the parity oracle). Get user approval.
4. **Port** each board via the §3 vertical (agent with the "write compute first" resilience note, or by
   hand). Per-board commit. Keep the shared registry files assembled by the lead if fanning out.
5. **Verify:** `swift build && swift test` green (re-run yourself); `git diff --name-status origin/main HEAD`
   is exactly the intended files; scope contract honored.
6. **PR** the wave branch → `main`; let CI (typecheck·tests·build) go green; merge (merge-commit).
7. **Update memory** (`lariat-native-port-status.md`) + this roadmap's status line.

---

## 9. Exit criteria (Phase A complete)

Every operator-facing web screen has a native equivalent at behavior parity (rules + audited writes);
`swift build && swift test` green; each wave merged to `main`; the edge-blocker log
(`edge-blockers.md`) lists exactly the surfaces that intentionally stay Next.js (guest BEO e-sign,
PWA, and — pending the A5.4 decision — cross-host sync/peers/cloud-bridge). Then Phase B (LLM) → C
(schema inversion) → D (edge reduction) → E (cutover + delete, load-bearing paths relocated first).

---

## 10. Open decisions for the user (surface before/at each wave)

1. **Tiers:** A4 → new `.costing`/`.inventory` tier(s) or more `manager.*`? A6 → `.foh`/`.events`/
   `.shows` tier(s)? (Same call as `.labor`; A0 makes adding a tier cheap.)
2. **A5.4 sync/peers/cloud-bridge:** native sync client, or keep the transport in the Next.js edge and
   port only read/status UI? (Recommend: edge for now.)
3. **Web F15 glove-change:** if the in-flight web removal lands, do we mirror the removal in native
   stations? (Track the `v2-freeze-closeout` branch.)
4. **PR cadence:** one PR per wave (recommended, reviewable) vs. one per group.
5. **Order:** recommend A4 (finishes the costing/inventory story already half-built) → A5 (mostly
   read/PIN, reuses primitives) → A6 (largest, greenfield) last.
