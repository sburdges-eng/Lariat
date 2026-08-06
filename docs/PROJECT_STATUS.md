---
title: "Lariat project status — web and native"
date: 2026-08-06
status: current
canonical_id: lariat-project-status
---

# Lariat project status

**As of:** 2026-08-06 (refreshed after the merge pass) · `origin/main` `e6cb9c9`

> This repo's commit messages can be aspirational. For any "is X done?" question,
> the code wins over this document — grep the symbol, table, or test on
> `origin/main`. Every row below names the evidence it rests on and how far that
> evidence goes.

## Where the project is

| Lane | Half | State | Evidence | Confidence |
|---|---|---|---|---|
| BOH ops packet (`/boh`, offline line book) | web | shipped | #573, #574, #576, #578, #593; `git ls-tree origin/main -- app/boh` returns `page.jsx`, `SheetBoard.jsx`, `layout.jsx`, `error.jsx`, `not-found.jsx` + 2 test files | HIGH |
| Sync boot/replication hardening | web | shipped | #577; diff touches `lib/syncSchedulerLifecycle.ts` + `tests/js/test-sync-scheduler-lifecycle.mjs` (PR file list read, diff content not inspected) | MED |
| Commercial v1 phase 0 | shared | shipped | #584; diff touches `.github/workflows/ci.yml`, `.github/workflows/native-ci.yml`, `lib/pin.ts`, `middleware.js`, `scripts/coverage-sweep.mjs`, `docs/TEST_COVERAGE.md`, `CLAUDE.md`, + 30 test files incl. `tests/js/test-unconfigured-install-bootstrap.mjs`, `tests/js/test-unconfigured-install-fails-closed.mjs`. Named "phase 0" — no phase-1 doc or PR found in this window. | HIGH |
| Costing recovery + master catalog | web | shipped | #594, #595, #597, #599 merged; `lib/computeEngine/rollupRecipeCosts.ts:132,462,491,546` — `map_status`/`NEEDS_DENSITY` handling is real and wired, operator-curated status is never downgraded (matches #599's claim); #604 merged 2026-08-06; adds `lib/masterCatalogParse.ts` + `scripts/import-master-catalog.mjs` | HIGH |
| Ingredient map / yields coverage | web | shipped | #589, #591, #592, #596, #598; `ingredient_yields` table (`lib/db.ts:1550`) + `bom_coverage_pct` computed at `scripts/ingest-costing.mjs:500` and warned-on at `:1298` when coverage falls below 50% | HIGH |
| Hermetic-DB CI | shared | shipped | #551, #600, #601, #603; `.github/workflows/ci.yml:169` and `:195` — "no suite may touch the shared database" step is a real CI assertion, not just described | HIGH |
| CI gate expansion | shared | shipped | #546–#550, #588 (also touched by #584); `.github/workflows/native-ci.yml:61-62` runs `swift test` on native-path PRs — the gate PR #547's title ("run the LariatNative swift test suites on native changes") matches; #588 diff touches `app/api/beo/fire-schedule/route.js` + `tests/js/test-pin-gate-coverage.mjs`, a carve-out fix riding along with the CI change | HIGH |
| Temp-PIN scope closure | web | shipped | #586, #587; `middleware.js:8-32` `SENSITIVE_PREFIXES` includes `/boh/sysco-count`, `/boh/purveyor-planner`, `/boh/manager-week`, `/boh/eod-log`, `/specials/saved`, `/host`; `middleware.js:118-148` `config.matcher` mirrors the same paths — the two-layer constraint (prefix list + matcher) is satisfied | HIGH |
| Web `/v2` Stage 1 cook pilot | web | blocked-owner | `docs/superpowers/plans/2026-08-05-v2-stage1-pilot.md:4` (`status: planned — code complete; in-person enablement`) and `:6` (`cutover: docs/V2_CUTOVER_PLAN.md`); `docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md:33` lists it as front P5, owner gate "In-person devices"; `docs/PROJECT_ROADMAP.md:172` — rollback owner named 2026-07-04, only remaining step is the in-person `/v2/enable` visit on pilot devices | HIGH |
| Cloud-bridge `/v2` canonical envelope | shared | shipped | #553–#562 (10 PRs); `LariatNative/Sources/LariatModel/CloudBridge/CanonicalJSON.swift` + `CloudBridgeEnvelope.swift:5-23` confirm the Swift twin exists on `origin/main` and explicitly cites `lib/cloudBridgePush.ts` as its web counterpart | HIGH |
| BEO cascade corrections | shared | shipped | #544, #552, #563, #564, #565, #568, #579–#583 (11 PRs); #552 touches `LariatNative/Sources/LariatModel/BeoCascadeClient.swift` + `BeoCascadeRepository.swift` + `BeoBoardView.swift` (native); #568 is `tests/js/test-beo-cascade-api.mjs` | HIGH |
| BEO event model + estimate | shared | shipped | #566, #567, #569, #570, #585, #590; #585 touches `app/api/beo/route.js` + `lib/beoRates.ts` (house-rate resolution); #590 is `LariatNative/Sources/LariatApp/UI/Boards/BeoPrepTaskListView.swift` — native, the same Tasks-tab feature as #569, so two of the six PRs are native-only and Half is shared, not web | HIGH |
| Allergen lookup / datapack-search hardening | shared | shipped | #541, #542, #543; `docs/ROLLING_REVIEW_LEDGER.md:26` and `:128` both read 🟢 **FROZEN**, "cleared on re-review at `13b1b36` (2026-07-15)" | HIGH |
| Repo housekeeping / docs | shared | shipped | #572, #575; docs-only commits (iteration-consolidation record, CLAUDE.md rewrite). Not independently diff-verified beyond title/date — low stakes | MED |
| Native unconfigured-install / first PIN | native | shipped | #606, #607, #609 all merged 2026-08-06. #607 (`RegulatedReadGate.swift`) and #609 (`ManagementWrite.swift` + 5 Shows board views) both refuse manager-tier and Shows reads/writes on an install with no manager PIN. #609 was stacked on #607 and had never run a Swift gate until #610 landed — it was retargeted to `main`, refreshed, and merged only after `swift build + test` passed (3m8s) | HIGH |
| Native packaging + data dir | native | shipped | #571; `LariatNative/Sources/LariatDB/DataDirectory.swift` + `DatabasePaths.swift`; `LariatNative/Scripts/PACKAGING.md:79` + `LariatNative/Sources/LariatModel/StationCatalog.swift:136` confirm the `~/Library/Application Support/Lariat` fallback exists on `origin/main` | HIGH |
| Native CI on stacked PRs | native | shipped | #610 merged 2026-08-06; removed the `branches: [main]` filter from `pull_request:` in `.github/workflows/native-ci.yml`. Verified in effect: #609's Swift gate went from absent to `swift build + test` pass (3m8s) immediately after | HIGH |
| KDS re-bump audit entity id | native | shipped | #612 merged 2026-08-06. `LariatNative/Sources/LariatDB/KdsTicketRepository.swift` resolved the audit entity id from `lastInsertedRowID` behind an `== 0` guard; that value is the connection-wide `sqlite3_last_insert_rowid()`, so on a re-bump it held the *previous* bump's `audit_events` row and the guard never fired — every re-bump wrote an audit-table rowid as the ticket state's `entity_id`. Now SELECTs unconditionally, matching `app/api/kds/tickets/[id]/bump/route.js:138`. Pinned by `testRebumpCorrectionEntityIdIsTicketStateRowid`, which bumps two tickets so the two rowids diverge | HIGH |
| Native 1.0 gap fronts | native | blocked-owner | #605 **merged** 2026-08-06T09:26:43Z — all thirteen `docs/superpowers/plans/2026-08-05-*.md` plan files now resolve on `origin/main`, including [`2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md) and [`2026-08-05-g0-gui-smoke-and-shutoff.md`](superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md). The plans landing does not clear the blocker — what remains is Front 0 itself: the Mac GUI smoke test and the service-day shutoff test, both owner-only steps per that plan's own runner table | HIGH |

`Half` is `web`, `native`, or `shared`. `State` is `shipped`, `in-flight`,
`blocked-owner`, or `blocked-code`. `Confidence` is `HIGH` (grep-confirmed on
`origin/main` or PR diff read), `MED` (single source), or `LOW` (memory only —
treat as a lead, not a fact).

## Blocked on an owner decision

- **Native 0.2 GUI smoke test** — run `LariatNative/Scripts/package-app.sh --version 0.2.0` on a Mac, exercise `scale_recipe` + BEO cascade, confirm no `python3` process, reply pass/fail. Unblocks when the owner runs it. **Run PR #614 first** — without it a Finder-launched `.app` resolves to the Application Support data root instead of the repo database, so the smoke would exercise an empty second install. See [`2026-08-05-g0-gui-smoke-and-shutoff.md`](superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md).
- **Service-day shutoff test** — pick a live service day, turn Next.js off, fill `docs/superpowers/templates/service-day-shutoff-log.md`. Unblocks when the owner runs it and logs the result. Same plan file as above.
- **`/v2/enable` device visit (Stage 1 cook pilot)** — visit `/v2/enable` on each pilot device to start the clean production window; the code and rollback plumbing are already in place. Unblocks when the owner does the in-person visit. See [`2026-08-05-v2-stage1-pilot.md`](superpowers/plans/2026-08-05-v2-stage1-pilot.md) (front P5) and [`V2_CUTOVER_PLAN.md`](V2_CUTOVER_PLAN.md).
- **H8 notarization signing identity** — Front 1 in the gap-execution index (`docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md:24`). `docs/superpowers/plans/2026-08-05-h8-notarization.md:4` reads `status: planned — blocked on owner identity decision`; the open decisions (Developer ID identity string, notarization credentials, `.pkg` vs `.dmg`, Sparkle vs manual updates) are at `:15-18`.
- **Per-piece `per_count` calls** (carnitas taco, battered sliders, remaining 1-buffet-equals-1-batch items) — open per `beo-cascade-followups` memory; none of the 62 PRs in this window closes it beyond #579's chicken-confit/birria fix. **Carried from memory, not re-verified this session.**
- **HACCP `sync_feed` ratification** — logged as a blocker in `lariat-native-port-status` memory; no PR in this window touches it. **Carried from memory, not re-verified this session.**

## No code-work blockers — one open PR and a recommendation

The audit found zero blockers that need more code, and the review queue has since drained: #605,
#610, #607, #604, #611, #612, #613 and #609 all merged 2026-08-06.

- **#614 open** — recovers `07ee7c0` (packaged app shares the repo database) from a local-only
  worktree branch that had no PR and no remote copy. Gates Front 0: the GUI smoke runs
  `package-app.sh`, and without this a Finder-launched `.app` writes to a *second* database, so
  the smoke would test nothing real.
- **Recommendation:** "Commercial v1 phase 0" (#584) still has no phase-1 scoping doc or PR —
  worth defining what's next before the initiative stalls silently.
- **Recommendation:** the `lastInsertRowid` trap has now bitten twice — web (#425) and native
  (#612), same root cause, six weeks apart. It is not in `CLAUDE.md` §8 "Recurring bug patterns".
  One line there is the cheapest guard against a third.

## Do not re-open

Native work already finished is enumerated in the gap-execution index's
"Already done — do not re-open" table:
[`docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md).
That table is the authority; it is deliberately not copied here.

## Which document owns what

| Question | Document |
|---|---|
| What do the release and milestone names mean? | [`NATIVE_RELEASES_AND_TAXONOMY.md`](NATIVE_RELEASES_AND_TAXONOMY.md) — binding glossary |
| What is the next native front, and who gates it? | [`2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md) |
| Where does native code live, and what is canonical? | [`LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`](LARIAT_NATIVE_FINAL_AGENT_GUIDE.md) |
| Has this web section passed freeze review? | [`ROLLING_REVIEW_LEDGER.md`](ROLLING_REVIEW_LEDGER.md) |
| What did we decide, and when? | [`PROJECT_ROADMAP.md`](PROJECT_ROADMAP.md) — historical log |
| Which surfaces are contract-protected? | [`PROTECTED_CONTRACTS.md`](PROTECTED_CONTRACTS.md) |
| Who owns the `/v2` cutover — is it done, and what's left? | [`V2_CUTOVER_PLAN.md`](V2_CUTOVER_PLAN.md) |
| What did the pre-cutover integration audit find, and what's since closed? | [`INTEGRATION_AUDIT.md`](INTEGRATION_AUDIT.md) |
| What is done across web *and* native? | this document |

The routing above is one-way for the native docs PR #605 owns —
`NATIVE_RELEASES_AND_TAXONOMY.md`, `LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`,
`docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md`, and
`docs/superpowers/specs/2026-07-02-lariat-native-endgame.md`. This document
links out to them; they don't link back. That split is deliberate — #605
owns those four files, and this document does not edit them.

## Keeping this honest

Refresh the as-of SHA whenever a row changes. A row whose evidence is older than
the as-of SHA by more than a few weeks should be re-grepped before it is quoted.
