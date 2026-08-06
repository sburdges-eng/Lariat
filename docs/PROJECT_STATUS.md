---
title: "Lariat project status — web and native"
date: 2026-08-06
status: current
canonical_id: lariat-project-status
---

# Lariat project status

**As of:** 2026-08-06 · `origin/main` 597bae609318bf6cafd2671909c8715827467e95

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
| Costing recovery + master catalog | web | in-flight | #594, #595, #597, #599 merged; `lib/computeEngine/rollupRecipeCosts.ts:132,462,491,546` — `map_status`/`NEEDS_DENSITY` handling is real and wired, operator-curated status is never downgraded (matches #599's claim); #604 open (mergeable, CI green), adds `lib/masterCatalogParse.ts` + `scripts/import-master-catalog.mjs` | HIGH |
| Ingredient map / yields coverage | web | shipped | #589, #591, #592, #596, #598; `ingredient_yields` table (`lib/db.ts:1550`) + `bom_coverage_pct` computed at `scripts/ingest-costing.mjs:500` and warned-on at `:1298` when coverage falls below 50% | HIGH |
| Hermetic-DB CI | shared | shipped | #551, #600, #601, #603; `.github/workflows/ci.yml:169` and `:195` — "no suite may touch the shared database" step is a real CI assertion, not just described | HIGH |
| CI gate expansion | shared | shipped | #546–#550, #588 (also touched by #584); `.github/workflows/native-ci.yml:61-62` runs `swift test` on native-path PRs — the gate PR #547's title ("run the LariatNative swift test suites on native changes") matches; #588 diff touches `app/api/beo/fire-schedule/route.js` + `tests/js/test-pin-gate-coverage.mjs`, a carve-out fix riding along with the CI change | HIGH |
| Temp-PIN scope closure | web | shipped | #586, #587; `middleware.js:8-32` `SENSITIVE_PREFIXES` includes `/boh/sysco-count`, `/boh/purveyor-planner`, `/boh/manager-week`, `/boh/eod-log`, `/specials/saved`, `/host`; `middleware.js:118-148` `config.matcher` mirrors the same paths — the two-layer constraint (prefix list + matcher) is satisfied | HIGH |
| Cloud-bridge `/v2` canonical envelope | shared | shipped | #553–#562 (10 PRs); `LariatNative/Sources/LariatModel/CloudBridge/CanonicalJSON.swift` + `CloudBridgeEnvelope.swift:5-23` confirm the Swift twin exists on `origin/main` and explicitly cites `lib/cloudBridgePush.ts` as its web counterpart | HIGH |
| BEO cascade corrections | shared | shipped | #544, #552, #563, #564, #565, #568, #579–#583 (11 PRs); #552 touches `LariatNative/Sources/LariatModel/BeoCascadeClient.swift` + `BeoCascadeRepository.swift` + `BeoBoardView.swift` (native); #568 is `tests/js/test-beo-cascade-api.mjs` | HIGH |
| BEO event model + estimate | shared | shipped | #566, #567, #569, #570, #585, #590; #585 touches `app/api/beo/route.js` + `lib/beoRates.ts` (house-rate resolution); #590 is `LariatNative/Sources/LariatApp/UI/Boards/BeoPrepTaskListView.swift` — native, the same Tasks-tab feature as #569, so two of the six PRs are native-only and Half is shared, not web | HIGH |
| Allergen lookup / datapack-search hardening | shared | shipped | #541, #542, #543; `docs/ROLLING_REVIEW_LEDGER.md:26` and `:128` both read 🟢 **FROZEN**, "cleared on re-review at `13b1b36` (2026-07-15)" | HIGH |
| Repo housekeeping / docs | shared | shipped | #572, #575; docs-only commits (iteration-consolidation record, CLAUDE.md rewrite). Not independently diff-verified beyond title/date — low stakes | MED |
| Native unconfigured-install / first PIN | native | in-flight | #606 merged (`LariatNative/Sources/LariatDB/ManagerPinRepository.swift` + `ManagerPinBootstrapTests.swift`); #607 open, based on `main`, touches `RegulatedReadGate.swift` and gets a real Swift CI run; #609 open touches `ManagementWrite.swift` + 5 Shows board views but is stacked on #607's branch, and `native-ci.yml` (pre-#610) filters `pull_request:` to `branches: [main]` — so #609's green check is the unrelated web gate, not a Swift run of its own code | HIGH |
| Native packaging + data dir | native | shipped | #571; `LariatNative/Sources/LariatDB/DataDirectory.swift` + `DatabasePaths.swift`; `LariatNative/Scripts/PACKAGING.md:79` + `StationCatalog.swift:136` confirm the `~/Library/Application Support/Lariat` fallback exists on `origin/main` | HIGH |
| Native CI on stacked PRs | native | in-flight | #610 open (mergeable, CI green); its diff removes the `branches: [main]` filter from `pull_request:` in `.github/workflows/native-ci.yml`; PR body documents the exact gap above — #609 (all-Swift) opened stacked on #607 and showed one green web check covering none of its own code | HIGH |
| Native 1.0 gap fronts | native | blocked-owner | #605 **merged** 2026-08-06T09:26:43Z — all thirteen `docs/superpowers/plans/2026-08-05-*.md` plan files now resolve on `origin/main`, including [`2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md) and [`2026-08-05-g0-gui-smoke-and-shutoff.md`](superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md). The plans landing does not clear the blocker — what remains is Front 0 itself: the Mac GUI smoke test and the service-day shutoff test, both owner-only steps per that plan's own runner table | HIGH |

`Half` is `web`, `native`, or `shared`. `State` is `shipped`, `in-flight`,
`blocked-owner`, or `blocked-code`. `Confidence` is `HIGH` (grep-confirmed on
`origin/main` or PR diff read), `MED` (single source), or `LOW` (memory only —
treat as a lead, not a fact).

## Blocked on an owner decision

- **Native 0.2 GUI smoke test** — run `LariatNative/Scripts/package-app.sh --version 0.2.0` on a Mac, exercise `scale_recipe` + BEO cascade, confirm no `python3` process, reply pass/fail. Unblocks when the owner runs it. See [`2026-08-05-g0-gui-smoke-and-shutoff.md`](superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md).
- **Service-day shutoff test** — pick a live service day, turn Next.js off, fill `docs/superpowers/templates/service-day-shutoff-log.md`. Unblocks when the owner runs it and logs the result. Same plan file as above.
- **H8 notarization signing identity** — a later front in the gap-execution index; memory logs it "cert-gated." **Not independently re-verified this session — carried forward as unconfirmed-current.**
- **Per-piece `per_count` calls** (carnitas taco, battered sliders, remaining 1-buffet-equals-1-batch items) — open per `beo-cascade-followups` memory; none of the 62 PRs in this window closes it beyond #579's chicken-confit/birria fix. **Carried from memory, not re-verified this session.**
- **HACCP `sync_feed` ratification** — logged as a blocker in `lariat-native-port-status` memory; no PR in this window touches it. **Carried from memory, not re-verified this session.**

## Blocked on code work

- #604, #607, #610 are mergeable with a genuine green CI run and simply await review. #609 is also mergeable, but its green check is the unrelated web gate, not a Swift run of its own code (see the Native unconfigured-install row above) — re-verify it gets a real native CI run after #610 merges before trusting that status.
- **Recommendation:** "Commercial v1 phase 0" (#584) has no phase-1 scoping doc or PR yet in this window — worth a follow-up to define what's next before the initiative stalls silently.

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
| What is done across web *and* native? | this document |

## Keeping this honest

Refresh the as-of SHA whenever a row changes. A row whose evidence is older than
the as-of SHA by more than a few weeks should be re-grepped before it is quoted.
