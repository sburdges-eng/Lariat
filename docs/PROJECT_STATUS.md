---
title: "Lariat project status — web and native"
date: 2026-08-29
status: current
canonical_id: lariat-project-status
---

# Lariat project status

**As of:** 2026-08-29 · `origin/main` `357a1be47d0be5c3856e9452255679d90f6e89c5`
(previously 2026-08-06 · `597bae6`, seventy-two commits back)

> This repo's commit messages can be aspirational. For any "is X done?" question,
> the code wins over this document — grep the symbol, table, or test on
> `origin/main`. Every row below names the evidence it rests on and how far that
> evidence goes.
>
> **Refresh scope, 2026-08-29.** The rows whose evidence named an open PR were
> re-checked against `357a1be4` and corrected; #604, #607, #609, #610, #611 and
> #613 have all merged, so nothing in the 2026-08-06 review queue is still open.
> The remaining rows are **carried forward unverified** — they keep their
> original 2026-08-06 evidence and should be re-grepped before being quoted.
> Saying which rows were re-checked and which were not is the point; a blanket
> "as of" date over rows nobody re-read is how the previous two versions of this
> document went wrong.

## Where the project is

| Lane | Half | State | Evidence | Confidence |
|---|---|---|---|---|
| BOH ops packet (`/boh`, offline line book) | web | shipped | #573, #574, #576, #578, #593; `git ls-tree origin/main -- app/boh` returns `page.jsx`, `SheetBoard.jsx`, `layout.jsx`, `error.jsx`, `not-found.jsx` + 2 test files | HIGH |
| Sync boot/replication hardening | web | shipped | #577; diff touches `lib/syncSchedulerLifecycle.ts` + `tests/js/test-sync-scheduler-lifecycle.mjs` (PR file list read, diff content not inspected) | MED |
| Commercial v1 phase 0 | shared | shipped | #584; diff touches `.github/workflows/ci.yml`, `.github/workflows/native-ci.yml`, `lib/pin.ts`, `middleware.js`, `scripts/coverage-sweep.mjs`, `docs/TEST_COVERAGE.md`, `CLAUDE.md`, + 30 test files incl. `tests/js/test-unconfigured-install-bootstrap.mjs`, `tests/js/test-unconfigured-install-fails-closed.mjs`. Named "phase 0" — no phase-1 doc or PR found in this window. | HIGH |
| Costing recovery + master catalog | web | shipped | #594, #595, #597, #599 merged; `lib/computeEngine/rollupRecipeCosts.ts:132,462,491,546` — `map_status`/`NEEDS_DENSITY` handling is real and wired, operator-curated status is never downgraded (matches #599's claim); #604 **merged**; `lib/masterCatalogParse.ts` and `scripts/import-master-catalog.mjs` both resolve on `origin/main` | HIGH |
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
| Native unconfigured-install / first PIN | native | shipped | #606 merged (`LariatNative/Sources/LariatDB/ManagerPinRepository.swift` + `ManagerPinBootstrapTests.swift`); #607 **merged**, touched `RegulatedReadGate.swift`; #609 **merged**, touched `ManagementWrite.swift` + 5 Shows board views but is stacked on #607's branch, and `native-ci.yml` (pre-#610) filters `pull_request:` to `branches: [main]` — so #609's green check is the unrelated web gate, not a Swift run of its own code | HIGH |
| Native packaging + data dir | native | shipped | #571; `LariatNative/Sources/LariatDB/DataDirectory.swift` + `DatabasePaths.swift`; `LariatNative/Scripts/PACKAGING.md:79` + `LariatNative/Sources/LariatModel/StationCatalog.swift:136` confirm the `~/Library/Application Support/Lariat` fallback exists on `origin/main` | HIGH |
| Native CI on stacked PRs | native | shipped | #610 **merged**; its diff removed the `branches: [main]` filter from `pull_request:` in `.github/workflows/native-ci.yml`; PR body documents the exact gap above — #609 (all-Swift) opened stacked on #607 and showed one green web check covering none of its own code | HIGH |
| Native 1.0 gap fronts | native | blocked-owner | #605 **merged** 2026-08-06T09:26:43Z — all thirteen `docs/superpowers/plans/2026-08-05-*.md` plan files now resolve on `origin/main`, including [`2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md) and [`2026-08-05-g0-gui-smoke-and-shutoff.md`](superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md). The plans landing does not clear the blocker — what remains is Front 0 itself: the Mac GUI smoke test and the service-day shutoff test, both owner-only steps per that plan's own runner table | HIGH |

`Half` is `web`, `native`, or `shared`. `State` is `shipped`, `in-flight`,
`blocked-owner`, or `blocked-code`. `Confidence` is `HIGH` (grep-confirmed on
`origin/main` or PR diff read), `MED` (single source), or `LOW` (memory only —
treat as a lead, not a fact).

## Blocked on an owner decision

- **Native 0.2 GUI smoke test** — run `LariatNative/Scripts/package-app.sh --version 0.2.0` on a Mac, exercise `scale_recipe` + BEO cascade, confirm no `python3` process, reply pass/fail. Unblocks when the owner runs it. See [`2026-08-05-g0-gui-smoke-and-shutoff.md`](superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md).
- **Service-day shutoff test** — pick a live service day, turn Next.js off, fill `docs/superpowers/templates/service-day-shutoff-log.md`. Unblocks when the owner runs it and logs the result. Same plan file as above.
- **`/v2/enable` device visit (Stage 1 cook pilot)** — visit `/v2/enable` on each pilot device to start the clean production window; the code and rollback plumbing are already in place. Unblocks when the owner does the in-person visit. See [`2026-08-05-v2-stage1-pilot.md`](superpowers/plans/2026-08-05-v2-stage1-pilot.md) (front P5) and [`V2_CUTOVER_PLAN.md`](V2_CUTOVER_PLAN.md).
- **H8 notarization signing identity** — Front 1 in the gap-execution index (`docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md:24`). `docs/superpowers/plans/2026-08-05-h8-notarization.md:4` reads `status: planned — blocked on owner identity decision`; the open decisions (Developer ID identity string, notarization credentials, `.pkg` vs `.dmg`, Sparkle vs manual updates) are at `:15-18`.
- **Per-piece `per_count` calls** (carnitas taco, battered sliders, remaining 1-buffet-equals-1-batch items) — open per `beo-cascade-followups` memory; none of the 62 PRs in this window closes it beyond #579's chicken-confit/birria fix. **Carried from memory, not re-verified this session.**
- **HACCP `sync_feed` ratification** — logged as a blocker in `lariat-native-port-status` memory; no PR in this window touches it. **Carried from memory, not re-verified this session.**

## What a whole-repo gap audit found, 2026-08-29

Eleven read-only sweeps over `357a1be4`, adversarially verified. Seven PRs opened;
`ORCHESTRATOR_STATUS.md` carries the table and the landing order. The findings worth
recording here because they change how this document should be read:

- **The audit surface nobody was watching was the LLM write path.** The kitchen
  assistant reached the same HACCP tables as the boards without the same rules: an
  out-of-range temperature stamped `pass`, the validator's own complaint stored as the
  corrective action, a drift-band delivery filed as clean, `scale_recipe` ungated. Every
  §15 command was green throughout. (#637)
- **A "contract" test that was a mirror.** `test-management-rollup.mjs` declared itself
  the contract for the management read models while defining its own copy of the page's
  SQL — and the copy had already rotted. `PROTECTED_CONTRACTS.md` §15 credits that suite
  with protecting location scoping, which it did not. (#642)
- **Two guards that were vacuous or nearly so.** `test-boh-pin-coverage.mjs` guarded four
  places the line-book tier split is written down; the JavaScript bundle was a fifth, and
  the whole packet was shipping to any phone that opened `/boh` with no PIN. (#636)
- **Correct code with no callers reads as done.** `ee8dd72d` threaded the service day
  into two rollup helpers that nothing calls, while both rendering call sites kept the
  unscoped form. A grep for the symbol would have said the work landed. (#641)

The lesson for this document: a row saying "shipped" with a PR number as its evidence
means the code merged, not that it is correct or that anything guards it. Where a row's
evidence is a test, check that the test exercises the shipped code rather than a copy of
it.

## Still open

- **Service-date migration, steps 8 and 9** — native `ServiceDate` plus the cross-language
  parity gate, and the regression sweep that fails when a new `todayISO()` or inline
  `toISOString().slice(0, 10)` appears outside an allowlist. Spec:
  [`2026-08-06-service-date-design.md`](superpowers/specs/2026-08-06-service-date-design.md).
  Waves 1–5 are done — the ~25 remaining `todayISO()` call sites were each checked and
  are deliberate (rolling analytics windows, cert-expiry calendars, booking dates).
  Claimed by another agent session as of 2026-08-29; not covered by the seven PRs.
- **`npm run verify` is not hermetic** — see the followups in `ORCHESTRATOR_STATUS.md`.

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
