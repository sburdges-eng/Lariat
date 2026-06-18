---
date: 2026-06-17
topic: vendor-compare-v2-mapping
origin: docs/brainstorms/2026-06-17-vendor-compare-quality-locks-requirements.md
supersedes_deferrals:
  - equivalence-mapping UI
  - order guide preferred/lock visibility (partial — not row sync)
---

# Vendor compare v2 — mapping + order guide visibility

## Summary

Extend the ops data plane so the kitchen manager can **grow compare coverage** without leaving Lariat: link Sysco and Shamrock catalog rows to shared ingredient masters, then see **preferred vendor**, **quality lock**, and **guide-vs-preferred mismatch** on the flat order guide. v1 compare (#358) handles mapped pairs only; v2 closes the loop from “no mapped pairs yet” to “staple shows on compare.”

**Explicitly out of v2:** morning digest / management nudges, `order_guide_items` vendor sync, fuzzy auto-matching, native macOS surface, LaRi conversational compare.

## Problem frame

After v1, compare works for staples that already share a `master_id` on both vendor price rows. On order day the KM still:

1. Finds Sysco and Shamrock equivalents outside Lariat (spreadsheet or memory) when only one side is linked.
2. Cannot record a new cross-vendor pair without workbook/ingest map work.
3. Sets preferred/lock on compare but the **order guide** still looks like a flat ingest sheet with no signal when guide vendor disagrees with master preference.

Hardest pains from v1 brainstorm remain **equivalence (A)** and **pack normalization (B)** for unmapped items; v2 tackles **A** (mapping). Normalization stays honest on compare — mapping does not invent comparable prices.

## Decisions (brainstorm 2026-06-17)

| Topic | Decision |
|-------|----------|
| v2 slice | **Mapping + order guide badges** — skip proactive nudges |
| Mapping workflows | **Both:** pair-from-scratch + attach orphan vendor row to existing master |
| UI placement | **Split:** `/purchasing/link` for new pairs; `/purchasing/compare` gains attach for single-vendor masters |
| Order guide | **Preferred + lock + mismatch warning** — guide vendor column stays ingest-owned |
| Auto-match | **None** — KM confirms every link (same posture as v1 R10) |
| Write authority | **PIN-gated** — same manager tier as v1 compare PATCH (inherits v1 OQ1) |

## Requirements

### R1 — Pair-from-scratch (`/purchasing/link`)

- KM selects **one Sysco** and **one Shamrock** catalog row (latest `vendor_prices` per vendor+sku or ingredient key).
- KM provides or confirms a **canonical name** for the new master (line-cook language; no dev slugs in UI).
- System creates or reuses an `ingredient_masters` row and sets `vendor_prices.master_id` on **both** rows.
- After save, the staple appears on `/purchasing/compare` when normalization allows.
- **No fuzzy suggestions** ranked as auto-links — search/filter only.

### R2 — Attach missing vendor (`/purchasing/compare`)

- Compare page lists **single-vendor masters** (today’s `masters_single_vendor_only` signal) with an **Attach** action.
- KM picks the missing vendor’s catalog row from a searchable list (opposite vendor only).
- System sets `master_id` on the attached row; does not change the existing side’s link.
- Pair-from-scratch remains on `/purchasing/link` when neither side is mapped.

### R3 — Mapping write durability

- Operator links persist across `ingest-costing` re-runs (same durability bar as v1 SC4 for `preferred_vendor` / quality lock).
- Re-ingest must not clear KM-set `vendor_prices.master_id` on rows the operator linked in-app.
- Mapping actions emit **audit** records (correction or dedicated action) so master/catalog changes are traceable.

### R4 — Order guide visibility (`/purchasing`)

- For each order guide row, when a match exists to `vendor_prices` (ingredient + vendor) with a `master_id`:
  - Show **preferred vendor** label when `ingredient_masters.preferred_vendor` is set.
  - Show **lock** indicator when `quality_locked`.
  - Show **mismatch warning** when order-guide `vendor` ≠ `preferred_vendor` (informational — guide row is not rewritten).
- Rows with no master link show no badge (honest empty state).

### R5 — Coverage UX

- Compare and link surfaces show updated counts: mapped pairs, single-vendor, unlinked catalog rows (Sysco/Shamrock only in v2).
- Empty compare state links to **Link vendors** (`/purchasing/link`), not only “costing first.”

### R6 — Copy and audience

- Manager / order-day KM on kitchen laptop; labels per `docs/UI_COPY_RULES.md`.
- USD two decimals on any price shown; no SaaS jargon (“master” OK only if paired with plain “staple” or “item” in headings).

## Success criteria

| ID | Criterion |
|----|-----------|
| SC1 | Pair flow: after linking Sysco+Shamrock rows, GET compare returns the row with both offers. |
| SC2 | Attach flow: single-vendor master + attach → compare shows both vendors. |
| SC3 | Re-ingest costing fixture does not strip operator-set `master_id` on linked rows. |
| SC4 | Order guide shows preferred + lock + mismatch when master disagrees with guide vendor. |
| SC5 | No automatic link without explicit KM confirm (no new rows from fuzzy match). |

## Scope boundaries

### In scope

- `/purchasing/link` page (pair picker).
- Compare page attach section + API for link/attach writes.
- Order guide badge column or inline indicators.
- Tests with realistic vendor catalog fixtures (not `foo`/`bar`).

### Deferred (v3+)

- Morning digest / management tile “cheaper alternate.”
- Syncing `order_guide_items.vendor` from preferred master.
- US Foods or third vendor.
- LaRi-assisted mapping suggestions as primary UI.
- Native macOS compare/link.

### Outside identity

- Automated ordering APIs; cloud price feeds.

## Open questions for planning

| ID | Question | Lean |
|----|----------|------|
| OQ1 | Persist mapping via `ingredient_maps` confirmed row + ingest path, or direct `vendor_prices.master_id` PATCH with ingest ON CONFLICT preserve? | Mirror v1 ingest preserve pattern; planner picks one write path. |
| OQ2 | Match order guide → `vendor_prices` on `ingredient` string only, or ingredient+sku when sku exists on guide? | Start ingredient+vendor; document ambiguity. |
| OQ3 | Create `master_id` slug formula on pair — reuse ingest slug helper or KM-visible id? | Reuse `ingredient_key` / ingest slug; hide slug in UI. |

## Dependencies

- v1 vendor compare shipped (#358).
- Fresh Sysco/Shamrock ingest before order-day use.
- PIN middleware on purchasing/costing write routes.

## Sources

- `docs/brainstorms/2026-06-17-vendor-compare-quality-locks-requirements.md`
- `docs/plans/2026-06-17-005-feat-vendor-compare-quality-locks-plan.md` (deferrals §)
- `lib/vendorCompare.ts`, `app/purchasing/compare/page.jsx`, `app/purchasing/page.jsx`
- `scripts/ingest-costing.mjs` (master_id + map posture)
- `STRATEGY.md` — ops data plane track
