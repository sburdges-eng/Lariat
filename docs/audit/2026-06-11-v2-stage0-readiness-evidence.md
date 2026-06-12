# v2 Stage-0 readiness evidence — 2026-06-11

Release-evidence note per `docs/V2_CUTOVER_PLAN.md` ("Release evidence to
capture"). Covers cutover entry criteria 2 and 3 and the Stage-0 smoke; the
single remaining entry-criterion blocker is hardware evidence (criterion 4).

## Candidate

- Base: `main` @ `c1d432f` (post #318/#320/#321) plus the
  `feat/v2-cutover-readiness` slice (this PR — final SHA in the PR merge).
- v2 route tree: `/v2/today`, `/v2/kds/punch`, `/v2/eighty-six`,
  `/v2/stations` + `/v2/stations/[id]`, `/v2/command`, `/v2/management`,
  `/v2/analytics` — cookie-gated (`lariat_v2=1`), side-by-side, v1 default.

## Entry criterion 2 — full-shift parity audit (2026-06-11)

Every v2 surface either renders live data natively or embeds the **live v1
page component**, so write paths are shared with v1 by construction:

| Surface | Shape | Location wiring | Write path |
|---|---|---|---|
| `/v2/today` | native v2 server page | awaited `searchParams` | read-only board (stations, 86, stock moves from live DB) |
| `/v2/kds/punch` | embeds `PunchTicketPage` (client) | `useLocation()` client hook | same `/api` POST as v1 |
| `/v2/eighty-six` | embeds `EightySixPage` (server) | resolved `searchParams` passed down | `/api/eighty-six` + `/resolve`, same as v1 |
| `/v2/stations` | embeds `StationsPage` | resolved `searchParams` + `basePath="/v2/stations"` | read-only; links stay in v2 tree |
| `/v2/stations/[id]` | embeds `StationPage` | `params` + resolved `searchParams` | same line-check APIs as v1 |
| `/v2/command` | embeds `CommandCenter` | resolved `searchParams` | same as v1 |
| `/v2/management` | embeds `ManagementRollupPage` | resolved `searchParams` | same as v1 |
| `/v2/analytics` | embeds `AnalyticsPage` | page takes no props (location-agnostic, matches v1) | read-only |

No parity gaps found that block a full shift. The `searchParams` Promise
fix (PR #320) closed the one real defect (manager wrappers reading the
un-awaited promise).

## Stage-0 smoke — `tests/e2e/v2-smoke.spec.ts` (6/6 green)

Shift-style pass added to the e2e suite:

- gate: `/v2` closed without the preview cookie
- cook: today board renders live line state + jump cards
- cook: KDS punch embeds the live ticket form (real inputs)
- cook: 86 round trip — add on `/v2/eighty-six` → appears on `/v2/today`
  → resolve back in stock (writes through the live API)
- cook: station boards list and open within the v2 tree
- manager: command / management / analytics render with consistent location

## Entry criterion 3 — freeze gates (run 2026-06-11, all green)

| Gate | Command | Result |
|---|---|---|
| Route/workflow + full backend | `node --experimental-strip-types --test tests/js/*.mjs` | 4,313+ pass / 0 fail (2026-06-11 main) |
| Schema | `npm run test:schema` | 73/73 |
| Idempotency | `node --test tests/js/test-idempotency-coverage.mjs` | 3/3 |
| Unit (jest) | `npm run test:unit` | 136/136 |
| Rules | `npm run test:rules` | 390/390 |
| Typecheck | `npm run typecheck` | clean |
| Production build | `npm run build` | clean (`npm run verify` exit 0) |
| E2E (incl. Stage-0 smoke) | `npm run test:e2e` | 21/21 |

## Criterion 4 — iPad hardware evidence (WAIVED by operator, 2026-06-12)

- **Operator decision 2026-06-12: the physical gen-7 iPad run is waived**
  for cutover entry ("skip ipad profile"). The acceptance rule changed per
  the runbook's escape hatch; the profiler gained `--no-hardware` to record
  software-only acceptance honestly (`hardwareRequired: false` in the report).
- **Software acceptance run (closure evidence under the waiver)** — WebKit
  (the iPad's engine family), iPad (gen 7) profile, `/v2` tree, 10
  iterations: `docs/audit/2026-06-12-ipad-profile-software-v2.json`.
  All flows pass: station-pass p95 46.4 ms, kds-send p95 59.7 ms,
  86-add p95 70.9 ms (threshold 100 ms). `hardwareAcceptanceSatisfied: true`.
- **Stress preflight (context, not acceptance)** — Chromium with 4× CPU
  throttle, 10 iterations: `docs/audit/2026-06-12-ipad-profile-stress-4x-v2.json`.
  kds-send passes (59.2 ms); station-pass is marginal (p95 103.3 ms,
  avg 84.4); 86-add misses (p95 129.9 ms, avg 121.2). **Known residual
  risk**: on genuinely slow hardware the 86-add tap may exceed 100 ms.
  Stage-1's rollback trigger ("cook-tier responsiveness regresses enough
  that service work is materially slowed") is the operational guard.
- If a device run is ever wanted, the harness and procedure remain:
  `docs/audit/2026-06-09-ipad-gen7-hardware-runbook.md` (drop
  `--no-hardware`, add `--route-prefix /v2`).

## Known limitations acceptable for the first 30 days

- `/v2/analytics` is location-agnostic (inherits v1 behavior).
- `/v2/today` station grid shows only stations with an active line check
  for the day (empty early in a shift by design).
- v2 hero shells duplicate an `<h1>` with the embedded v1 page (cosmetic;
  screen readers see both headings).
- LaRi voice input uses the Web Speech API (PR #320); offline Whisper
  remains deferred (roadmap 2.6 residual).

## Stage 0 — internal shift smoke (EXECUTED 2026-06-12, all flows pass)

Run against a fresh production build (`npm run build && npm start`),
v1 still the default experience, v2 reached via the preview cookie:

1. Codified suite: `npm run test:e2e` — **22/22** (incl. the 7-test
   `v2-smoke.spec.ts` Stage-0 pass and the Spanish locale smoke).
2. Shift-flow drive (one-off script per the cutover plan's Stage-0
   checklist — the two write-flows the codified suite only
   render-checks were exercised for real):
   - `/v2/today` renders the live board
   - **KDS punch: a real ticket sent to the line** (order `#940180`,
     "Sent #… to the line" confirmation observed)
   - 86 round trip: add → propagates to `/v2/today` → resolve
   - **Station board: opened a board and passed a line item; the
     `pass` row verified persisted server-side** via
     `GET /api/checks` (cook `stage0-smoke`)
   - Manager: `/v2/command`, `/v2/management`, `/v2/analytics` render
     with consistent location

No critical flow failed → per the plan, Stage 1 (cook-tier pilot) may
begin once a rollback owner is named.

## Rollback owner

- _To be named per shift window at Stage-1 start (cutover plan requirement)._
