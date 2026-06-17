---
date: 2026-06-17
topic: vendor-compare-quality-locks
---

# Vendor compare and quality locks — requirements

## Summary

Add a manager-facing vendor-compare experience for **mapped** Sysco↔Shamrock ingredient pairs: normalized unit prices side by side, preferred-vendor selection for unlocked items, and **quality locks** that persist tribal "always buy this vendor" rules in Lariat.

## Problem Frame

On order day the kitchen manager manually price-compares Sysco vs Shamrock for the closest equivalent products. The hardest parts are finding a fair equivalent across vendors and normalizing pack sizes to an apples-to-apples unit price. Quality overrides (locked items) live only as mental knowledge today. Lariat does not yet record compare outcomes or locks; `/purchasing` shows a flat order guide with one vendor per row and no normalized cross-vendor view.

## Requirements

### Compare display

- R1. The compare experience lists ingredients where **both** Sysco and Shamrock catalog rows exist and share the same canonical ingredient master link.
- R2. Each row shows both vendors' offers with a **normalized comparable unit price** when the system can compute one honestly.
- R3. When normalization is not possible (missing pack data, catch-weight ambiguity, incompatible units), the row shows an explicit **cannot compare** state — not a misleading number.
- R4. For unlocked items, the UI highlights when the non-preferred vendor is cheaper on the normalized basis.
- R5. For quality-locked items, the locked vendor is visually primary; switch actions are disabled.

### Quality lock and preferred vendor

- R6. A manager can set **preferred vendor** on an unlocked mapped ingredient from the compare experience.
- R7. A manager can **quality-lock** an ingredient to a vendor with a short reason (e.g. "quality", "spec", "consistency").
- R8. A quality lock prevents changing preferred vendor through the compare UI until explicitly unlocked.
- R9. Preferred vendor and lock state persist across costing re-ingest (operator curation must not be silently reverted).

### Coverage and data posture

- R10. v1 includes **mapped pairs only** — no automatic fuzzy Sysco↔Shamrock matching.
- R11. Unmapped catalog items may appear in a separate **coverage** indicator (count or list) but are out of scope for side-by-side compare in v1.

### Audience and placement

- R12. Primary actor is the **kitchen manager** preparing or executing vendor orders (aligns with `STRATEGY.md` ops data plane).
- R13. Copy and labels follow line-cook / manager language constraints (`docs/UI_COPY_RULES.md`) — no SaaS jargon, USD to two decimals.

## Success criteria

- SC1. On a fixture DB with known mapped Sysco/Shamrock pairs, normalized prices match the same math used elsewhere in costing (within rounding tolerance).
- SC2. Setting preferred vendor on an unlocked item is visible on next page load without re-ingest.
- SC3. Quality-locked items cannot be switched via compare actions; unlock is a deliberate separate action.
- SC4. Re-running costing ingest does not clear operator-set preferred vendor or lock state.

## Scope boundaries

### In scope (v1)

- Manager compare view for mapped pairs.
- Preferred-vendor write and quality-lock write on canonical ingredient masters.
- Honest cannot-compare handling.

### Deferred for later

- UI to **confirm new** Sysco↔Shamrock equivalence mappings (equivalence-finding workflow).
- Automatic fuzzy vendor matching.
- Proactive nudges (management tile, morning digest: "cheaper alternate available").
- Native macOS compare surface (web-first unless planning finds trivial native reuse).
- LaRi-only conversational compare as the primary interface.

### Outside this product's identity

- Multi-vendor marketplace or automated ordering with vendors.
- Cloud-hosted price feeds replacing local ingest.

## Dependencies and assumptions

- **Assumption:** Enough staple ingredients already have confirmed master links via `ingredient_maps` / ingest to deliver order-day value in v1.
- **Assumption:** Sysco and Shamrock price catalogs are kept current through existing ingest workflows before compare is trusted.
- **Dependency:** Normalized unit price logic reuses existing vendor price and pack-weight semantics rather than inventing a parallel formula.

## Outstanding questions

### Deferred to planning

- OQ1. **Lock authority:** KM-only, any manager, or PIN-gated for lock/unlock?
- OQ2. **Order guide coupling:** Does preferred-vendor change update `/purchasing` order-guide rows in v1, or only the canonical master until workbook/ingest catches up?
- OQ3. **Locked-item display:** Show cheaper alternate prominently (informational) or de-emphasize/hide alternate price on locked rows?

## Sources

- `STRATEGY.md` — ops data plane track and operational data freshness metric.
- `app/purchasing/page.jsx` — current flat order guide (read-only).
- `lib/db.ts` — `ingredient_masters`, `vendor_prices`, confirmed-map posture (no fuzz-match).
- `scripts/ingest-costing.mjs` — `preferred_vendor` preserved across re-ingest on conflict update.
