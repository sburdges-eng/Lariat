# Phase 3 — Scoping

**Status:** Pre-plan. This doc surveys three feature ideas — KDS workflow management, inventory-management integration, advanced reporting — and identifies the forks that decide scope before a Phase 3 plan is written. It does not commit to a plan or task list.

**Predecessors:** Phase 2 (event-ops + Prism cutover + master-costing tile) closed; sales-driven depletion live (`lib/salesDepletion.ts`); T7 `ingredient_masters` populated; depletion-exception + pack-change triage queues in `/costing` shipped on PR #58.

**Why this doc:** each of the three ideas is a different feature depending on which fork the operator picks. We need the operator to pick the fork — not the engineer — because the ROI lives in the operational decision, not the implementation.

---

## 1. KDS workflow management

### State of the world today

No KDS surface exists in this Next.js codebase. The `pages/14_KDS.py` mention in `docs/SESSION_2026-04-04.md` refers to the archived Streamlit prototype in `Lariat-v2/`. Adjacent surfaces today: `app/prep/` (daily prep board with claim / done actions), `app/stations/[id]/` (station line-check + position view), `app/eighty-six/` (Toast outbound 86-sync from Phase 2). Tickets are not a first-class entity — Toast owns the ticket lifecycle; Lariat sees the result via `sales_lines` after the fact.

### What "v1" could mean

A **read-only ticket mirror**: pull open Toast checks via the Partner API, render grouped by station with course / fire / bump timestamps, 5–15 s poll. No write-back to Toast. Bump-state lives in a new `kds_ticket_states` table keyed on Toast `check_guid` so refreshes don't lose state.

### Decisions the operator has to make

1. **Read-only mirror vs. authoritative bump** — does the bump round-trip to Toast via `lib/toastApi.ts` (same pattern as Phase 2 86-sync) or stay local in `kds_ticket_states`?
2. **Polling vs. webhook** — webhooks need a public ingress; polling fits the offline-first stance and caps freshness at the interval.
3. **Per-station routing** — auto-route by `dish_components.station_id` or operator-assigned rules in a new `kds_routing_rules` table?
4. **Per-cook accountability** — bump tied to `cook_id` (PIN) or anonymous?

### Effort estimate

Read-only mirror + polling: **M**. Authoritative bump round-trip: **+M** (extends the Phase 2 outbound retry queue). Routing rules: **+S** category-driven, **+M** rule-table-driven. Per-cook accountability: **+S**.

### Dependencies

- Toast Partner API auth (scaffolded in Phase 2 `lib/toastApi.ts`).
- `dish_components.station_id` populated for the menu (today partial — same coverage gap as depletion).
- A real PIN-on-shift model — flagged as deferred in Phase 2 risk register; needed for per-cook accountability.

---

## 2. Inventory management integration

### State of the world today

Lariat owns inventory internally: `inventory_updates` (event log), `inventory_counts` + `inventory_count_lines` (periodic on-hand), `inventory_par`, and the sales-depletion path that auto-debits via `lib/salesDepletion.ts` after `npm run ingest:analytics`. Vendor-side data flows in from Sysco invoice PDFs and Shamrock price-lists / order-sheets / invoices / catch-weights / inventory sheets. T7 `ingredient_masters` collapses Sysco-vs-Shamrock fragmentation. "Integration" today is one-way ETL into Lariat.

### What "v1" could mean

**Closed-loop receiving**: when a Shamrock or Sysco delivery is checked in, write qty straight into `inventory_updates` (`direction='in'`) keyed on `master_id`, so on-hand reflects truth without a separate count session. Today the count session is the only mechanism that establishes on-hand; receiving is silent.

### Decisions the operator has to make

1. **Toast Inventory module vs. ignore it** — Toast sells an inventory add-on. If the venue pays for it, Lariat pulls and reconciles. If not, this fork is closed.
2. **Shamrock catalog sync (read-only) vs. order placement (write)** — read-only sync gives live pack-size + price (eliminates the pack-change queue's input lag). Order placement makes Lariat the purchasing UI.
3. **Internal-only closed-loop receiving** — no-vendor-API option: a receiving form on `/purchasing` writes `inventory_updates`. Cheap, deterministic, no external dependency.
4. **Reconciliation cadence** — daily cron or real-time on receiving entry?

### Effort estimate

Internal-only closed-loop receiving: **S** (one form + one tx; reuses Phase 1 audit pattern). Shamrock read-only catalog sync: **M**. Shamrock order placement: **L** (cart, approval flow, audit, retry queue). Toast Inventory module pull: **L–XL** depending on source-of-truth posture.

### Dependencies

- T7 `ingredient_masters` (already shipped) — required for any vendor-side join.
- `external_ids` registry from `lib/entities.ts` (already shipped) — required for Toast Inventory mirror.
- A signed Shamrock / Sysco API agreement — non-engineering blocker, weeks of lead time.
- PIN-gated `/purchasing` already exists; the receiving form drops in.

---

## 3. Advanced reporting and analytics

### State of the world today

`/analytics` renders Toast sales KPIs (revenue, avg check, DOW + hourly comparison, top items, Shamrock monthly spend) from `toast_sales_*` + `spend_monthly`. `/costing` carries three benchmark tiles (variance, unmapped, ingest age) plus dish-coverage and depletion-exception + pack-change triage queues. `/menu-engineering` renders the Stars / Plowhorses / Puzzles / Dogs quadrant. There is no cross-surface dashboard, no scheduled report, no export beyond `npm run export`, no labor-vs-revenue tile.

### What "v1" could mean

A **single rollup tile on a new `/management` index** — period revenue, COGS%, labor%, top hazards (plowhorses < 20% margin, depletion exceptions, pack-change unack), 28-day trend sparkline. One page, server-rendered, PIN-gated. Composes existing computes; no new SQL contracts.

### Decisions the operator has to make

1. **Live dashboard tile vs. scheduled PDF/email** — do managers open Lariat at start of shift (build the tile), or want a Monday-AM email (build the export + send)?
2. **Labor-cost integration** — `/analytics` today is sales-only; advanced reporting almost certainly means labor-vs-revenue and SPMH. Both 7shifts and Toast labor are ingested; the fork is committing to a single labor-source.
3. **Drill-down depth** — tile click lands on an existing surface (`/menu-engineering`, `/costing`) or a new per-tile drill page? Existing re-use keeps maintenance bounded.
4. **Variance-trend granularity** — per-recipe 28-day variance trend is on the Phase 2 master-costing roadmap; advanced reporting either subsumes it or stays orthogonal.

### Effort estimate

Rollup tile: **S**. Scheduled email/PDF: **M** (cron exists; PDF generation is the unknown). Labor-vs-revenue with SPMH: **M**. Per-recipe variance trend: **M** on `/costing`, **L** as a new drill page.

### Dependencies

- Phase 1 cron orchestrator (`scripts/run-job.mjs`) for any scheduled report — already shipped.
- A labor-source decision (7shifts vs. Toast labor) — the data is duplicated today and reports must commit to one.
- PIN gate covers `/management` already.
- No external API blockers.

---

## Recommended ordering

1. **Inventory closed-loop receiving (internal-only, S).** Highest leverage per unit of effort: it closes the silent gap between vendor delivery and on-hand state, makes the depletion engine's exceptions queue meaningfully shrink over time, and unblocks any Phase 3 reporting that wants real labor-vs-COGS without a count-session lag. No external dependencies.
2. **Advanced reporting v1 — single `/management` rollup tile (S).** Composes existing computes, no new contracts, PIN gate already there. Once receiving is closed-loop, the COGS% number on this tile is finally trustworthy. This is the "operator-facing payoff" for the receiving work.
3. **KDS workflow management — read-only Toast ticket mirror (M).** Largest of the three, biggest unknowns (poll vs. webhook, station-routing model), and it requires Toast Partner API write-paths to reach its full value. Sequence it last so the receiving + reporting work above can ride the existing Phase 2 Toast auth scaffolding without competing for it.

The Shamrock catalog sync, Toast Inventory mirror, scheduled-PDF reporting, and authoritative KDS bump are all sensible Phase 3.5 / Phase 4 follow-ons — but each is a different commitment, and none of them should ship before the operator picks the forks above.
