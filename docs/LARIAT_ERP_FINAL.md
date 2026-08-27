---
title: "Lariat ERP — combined-system completion record"
date: 2026-08-27
status: current
canonical_id: lariat-erp-final
---

# Lariat ERP — combined-system completion record

**As of:** 2026-08-27 · `Lariat` base `8472908` plus the changes recorded below,
on branch `claude/final-erp-completion-pnfm2q` across all four repos.

This document records how the four Lariat repositories compose into one
running, local-first restaurant ERP, what was completed and verified in the
2026-08-27 combination pass, and — per this repo's governance — exactly what
remains open and who owns it. It follows
[`LARIAT_ERP_MASTER_PROPOSAL.md`](LARIAT_ERP_MASTER_PROPOSAL.md) (the
direction) and [`PROJECT_STATUS.md`](PROJECT_STATUS.md) (the vocabulary:
`State` ∈ shipped / in-flight / blocked-owner / blocked-code, `Confidence` ∈
HIGH / MED / LOW, every row cites its evidence). It is a status snapshot, not
a declaration of finality: owner-gated items are named as owner-gated, never
claimed closed.

## The system at a glance

| Repo | Role in the ERP | Disposition |
|---|---|---|
| `Lariat` | **The hub.** Next.js + SQLite web app (receiving, inventory, costing, HACCP, labor, BEO/events, KDS server, POS/vendor ingest, management rollups) plus the LariatNative Swift package. Offline-first, deterministic, PIN-gated writes, audited. | Live (Web v2.0.x per the release glossary) |
| `Lariat-KDS` | **Companion KDS client.** Swift/SwiftUI iPad/macOS app that polls the hub's `GET /api/kds/tickets` and reports bumps to `POST /api/kds/tickets/:id/bump`. | Live client; wire drift fixed this pass (below) |
| `LARIATTRIALTHREEISO` | **Isolated experimental sandbox.** LariatHR SwiftUI app + LaRi Python fact engine over the restaurant's raw working data. Proven precursor domain logic; three file-bridge contracts toward the hub. | Experimental — not the production source of truth for any capability the hub ships |
| `lariat-kms-archive` | **Archived reference.** The original Flask/SQLite KMS. Every domain re-implemented, broader, in the hub. | ARCHIVED-REFERENCE — nothing deploys from it (see its README, added this pass) |

One production source of truth per capability: the `Lariat` hub. The KDS app
is its display client. The sandbox and the archive inform; they do not serve.

## What this pass completed — the whole-house pane of glass

The master proposal's capability map is now surfaced live in one place. The
GM Command Center (`/command`, `lib/commandCenter.summarize()`,
`GET /api/command/summary`, `GET /api/command/alerts`, and the morning digest
that consumes `alertsFor()`) previously composed sales, 86s, inventory pars,
labor, food safety, events, reservations, prep, price/margin moves, tables,
waste, and the day plan. This pass added the four ERP loops it was missing,
each composed from an already-shipped compute — no new tables, no new
business logic, no new mutation routes:

| ERP loop | Summary group | Composed from | Drilldown | Alert added |
|---|---|---|---|---|
| KDS | `kds.open_tickets` | same predicate as `GET /api/kds/tickets` and `dbQueryRegistry` `kds_open_tickets` (`bumped_at IS NULL`) | `/kds/punch` | — (open tickets are normal during service) |
| Receiving | `receiving.received_today`, `receiving.to_match` | today's accepted lines; the `/management` "Receiving to match" SQL verbatim | `/food-safety/receiving` | amber `receiving-to-match` |
| Costing | `costing.variance_pct`, `ingest_age_minutes`, `ingest_status`, `depletion_issues` | `readLatestAccountingVariance`, `readLastCostingIngest`, `listDepletionExceptions` — the `/management` tile helpers | `/costing` | amber `depletion-issues`; amber `costing-stale` (only once an ingest exists; failed counts as stale) |
| Cloud bridge | `cloud_bridge.queued`, `cloud_bridge.dead_letters` | `lib/cloudBridgeQueue` `depth()` / `deadLetterDepth()` (install-wide by design) | `/management/cloud-bridge` | red `cloud-dead-letters` |

Contract details preserved: the clean-DB alert invariant (a fresh install
surfaces exactly one amber, `performance-reviews-none`, and no reds) still
holds and is still asserted by `tests/js/test-command-summary-api.mjs`; all
new tile copy follows [`UI_COPY_RULES.md`](UI_COPY_RULES.md) (no "ERP",
"dashboard", or "sync" in user-facing text); location scoping matches each
composed helper (variance/depletion/receiving/KDS scoped; ingest freshness
and the outbox install-wide, like the pack-size count precedent on
`/management`).

Files: `lib/commandCenter.ts`, `app/command/page.jsx`,
`tests/js/test-command-summary-api.mjs` (12 new tests incl. a source-regex
tile-wiring contract).

## Cross-repo contracts (verified this pass)

1. **KDS ticket wire** (`docs/lariat-kds-protocol.md` in `Lariat-KDS`).
   Field-by-field parity audit found one real drift: the hub always emits
   `placed_at` via JS `Date.toISOString()` (millisecond precision, pinned by
   `tests/js/test-kds-tickets-route.mjs`), while the client's `TicketParser`
   used Foundation's `.iso8601` decoding, which rejects fractional seconds —
   the live client would have failed closed on every real ticket. Fixed in
   `Lariat-KDS` this pass: `TicketParser` now uses the same dual-format
   handling as its own `BumpResponseParser`, with a pinned test decoding the
   server's exact canonical string, and the protocol doc now states the
   precision rule and marks both server endpoints implemented. No wire field
   was added or renamed.
2. **KDS bump wire.** Already parity-clean: the client's
   `BumpResponseParser` accepts both timestamp forms; the hub's bump route
   response shape is pinned by `tests/js/test-kds-bump-route.mjs`. Bump
   writes land in `kds_ticket_states` + an audit event (Lariat-local bump
   state; Toast-authoritative bump remains deferred, below).
3. **Stage-plan bridge** (`LARIATTRIALTHREEISO`): cross-app show key
   `{location_id}|{band-slug}|{YYYY-MM-DD}` (`Services/LariatShowKey.swift`),
   handoff JSON in `.lari/stage_handoffs/` with status
   draft/sent/band_revised/approved, documented in
   `docs/stage-plan-bridge.md` there.
4. **86 availability bridge** (`LARIATTRIALTHREEISO`): `lari.py 86` writes
   `.lari/availability.json` → app import → `AvailabilityRecord` badges.
   The hub's own 86 board (`eighty_six` table) is the production 86 flow.
5. **LaRi CLI boundary** (`LARIATTRIALTHREEISO`): the LLM orchestrates, the
   CLI computes — all numbers come from `lari.py` stdout, scoped by
   `assert_hospitality_path`. Mirrors the hub's "runtime AI is
   non-authoritative for records" posture.

## Verification record — what ran green in this pass

Environment: clean Linux container, Node pinned to 24 per `.nvmrc` (the
container's default Node 22 reproduced two known environment-only failures —
the unref'd-timer cancellation in `test-cloud-bridge-graceful-stop.mjs` and
a pre-stamp `test-discover-route.mjs` — both green under Node 24 after
`npm run version:stamp`, confirming CLAUDE.md §2's guidance).

| Gate | Result |
|---|---|
| `Lariat` full `npm run verify` (typecheck, lint, all suites, `next build`) | green — see the final run recorded in this branch's history |
| §15 targeted suites for every family this pass reads (management rollup; cloud bridge ×7; receiving/depletion/compliance ×5) | 170/170 + 20/20 green |
| `test-command-summary-api.mjs` (extended) | 56/56 green |
| Dependent suites (`test-morning-digest`, `test-ops-run-api`, `test-v2-management`, `test-v2-command`) | 51/51 green |
| `LARIATTRIALTHREEISO` LaRi goldens (`lari.py test`) | 57/57, exit 0 (openpyxl installed; previously 1 env-only failure) |
| `LARIATTRIALTHREEISO` pure-Python suites from `verify_all.sh` | green on Linux (recipe_loss 33/33, depletion 85/85 + 227/227 integration, recipe_costs 21/21, variance ×2, dish_components, supplier_invoice_loader, session-branch guard) |
| `LARIATTRIALTHREEISO` Swift suites (~30 `swiftc` runners + SPM smokes) | **not runnable here** (macOS-only) — owner/CI gate |
| `Lariat-KDS` `swift test` | **not runnable here** (no Linux Swift toolchain in this environment) — the TicketParser change ships with its pinned test; run `swift test` on a Mac/CI before release |
| `Lariat` native gate (`swift build && swift test` in `LariatNative/`) | **not runnable here** — unchanged by this pass; native CI covers it |
| `lariat-kms-archive` pytest | 367 passed / 4 failed / 8 skipped — the archive's recorded final resting state (missing `templates/imports/manage.html`); not a gate, not to be "fixed" |

### Required verification by contract family (§15, reproduced verbatim)

Run the targeted suite for the surface you touched.

**Management rollup changes**

```bash
node --experimental-strip-types --test tests/js/test-management-rollup.mjs
```

**Sync apply or replay changes**

```bash
node --experimental-strip-types --test \
  tests/js/test-sync-apply.mjs \
  tests/js/test-sync-scheduler.mjs \
  tests/js/test-sync-scheduler-lifecycle.mjs \
  tests/js/test-sync-client.mjs
```

**Peer auth or topology changes**

```bash
node --experimental-strip-types --test \
  tests/js/test-peer-auth.mjs \
  tests/js/test-peers-route.mjs
```

**Cloud bridge changes**

```bash
node --experimental-strip-types --test \
  tests/js/test-cloud-bridge-drainer.mjs \
  tests/js/test-cloud-bridge-dead-letters-api.mjs \
  tests/js/test-cloud-bridge-queue-race-safety.mjs \
  tests/js/test-cloud-bridge-push.mjs \
  tests/js/test-cloud-bridge-canonical.mjs \
  tests/js/test-cloud-bridge-envelope-golden.mjs \
  tests/js/test-cloud-bridge-envelope-coverage.mjs
```

**Receiving, inventory, depletion, or compliance changes**

```bash
node --experimental-strip-types --test \
  tests/js/test-receiving-api.mjs \
  tests/js/test-receiving-rules.mjs \
  tests/js/test-depletion-exceptions.mjs \
  tests/js/test-compliance-hybrid.mjs \
  tests/js/test-compliance-rrf.mjs
```

Broad suite passes do not replace these targeted checks.

## What remains open — owner-gated, not code-gated

Per [`PROJECT_STATUS.md`](PROJECT_STATUS.md) and the gap-execution index
([`superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md`](superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md)),
these are NOT closed by this pass and cannot be closed from code:

- **Native 0.2 GUI smoke test** — owner runs `package-app.sh` on a Mac,
  exercises scale_recipe + BEO cascade, confirms no `python3` process.
- **Service-day shutoff test** — owner picks a live service day, turns
  Next.js off, fills the shutoff log template.
- **`/v2/enable` device visits** (Stage 1 cook pilot) — in-person, per
  [`V2_CUTOVER_PLAN.md`](V2_CUTOVER_PLAN.md); v1 is not retired and must
  not be until 30 clean default-on production days.
- **H8 notarization identity** — Developer ID / credentials / packaging
  decisions are the owner's.
- **Per-piece `per_count` calls** and **HACCP `sync_feed` ratification** —
  carried from memory in PROJECT_STATUS.md; still leads, not facts.
- **`Lariat-KDS` `swift test` + release** — the TicketParser fix needs its
  macOS/CI green run before shipping to devices.

## Deferred platform decisions (unchanged from the master proposal)

Postgres/MySQL migration; microservices split; Toast-authoritative KDS bump;
Shamrock/Sysco order placement; scheduled PDF/email reports. All remain
deferred for the reasons recorded in
[`LARIAT_ERP_MASTER_PROPOSAL.md`](LARIAT_ERP_MASTER_PROPOSAL.md) §"Deferred
platform decisions".

## Keeping this honest

The code wins over this document. Every row above names its evidence; a row
whose evidence is older than this doc's as-of date should be re-grepped
before it is quoted. Coverage numbers are never quoted codebase-wide without
the loaded-file denominator caveat in
[`TEST_COVERAGE.md`](TEST_COVERAGE.md).
