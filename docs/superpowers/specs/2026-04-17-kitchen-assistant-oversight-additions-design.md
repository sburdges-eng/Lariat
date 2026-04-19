# Kitchen Assistant Context — Management Oversight Additions

Date: 2026-04-17
File: `lib/kitchenAssistantContext.ts`

## Goal

Surface management-visible signals currently absent from the assistant's grounded context. Today the assistant sees counts and rosters but not *what's broken*, *what's missing*, or *what's trending*.

## Additions

### Always-on

1. **Failed line-check items (itemized)** — from `line_check_entries` where `shift_date=today`, `status='fail'`, `location_id=?`. Show `item @ station` with `note` if present. Cap 20.
2. **Stations without sign-off** — stations where `line_check_key IS NOT NULL` and no `station_signoffs` row for `shift_date=today`. Cap 10.
3. **Equipment out of service** — `equipment` where `status != 'active'` and `location_id=?`. Include most recent `equipment_maintenance.service_date` + type. Cap 15.
4. **Stale BEO prep** — `beo_prep_tasks` where parent event is within 2 days (inclusive), `done=0`, `location_id=?`. Cap 20.
5. **Repeat-offender 86s** — items from `eighty_six` 86'd on ≥3 distinct `shift_date`s in the last 7 days for `location_id=?`. Cap 10.

### Keyword-gated

6. **Recent Gold Stars** — trigger on `recognition|gold|award|praise|kudos|star`. Last 10 from `gold_stars` ordered by `id DESC`.
7. **Warranty expirations** — trigger on existing `VENDOR_KEYWORDS` plus `equipment|warranty|maintenance`. `equipment.warranty_expiration` within 30 days. Cap 10.

## Structure

- Each addition is a private helper: `renderLineCheckFailures`, `renderMissingSignoffs`, `renderEquipmentDown`, `renderStaleBeoPrep`, `renderRepeat86s`, `renderGoldStars`, `renderWarrantyAlerts`.
- Signature: `(db, locationId, date, ...extras) => { text: string; source: ContextSource | null }`.
- Main `buildGroundedContext` appends `text` directly and pushes `source` when non-null.
- Helpers guard-create missing tables when needed (gold_stars is created on-demand in the API route; mirror that pattern so the helper never crashes on a fresh db).
- All helpers return empty string when no rows — no section header emitted on empty result (avoids noise).

## Out of scope

- New DB schema. All additions read existing tables.
- Keyword tuning beyond what's listed.
- Refactoring existing sections.

## Risks / notes

- Repeat-86s query uses `COUNT(DISTINCT shift_date)` — not a hot path (small table), safe.
- `gold_stars` table may not exist yet on a fresh db (created lazily by `app/api/gold-stars/route.js`). Helper must `CREATE TABLE IF NOT EXISTS` before SELECT.
- Context budget: 7 sections × small footprint ≪ `MAX_CONTEXT_CHARS = 12000`. Existing truncation guard still applies at end.

## Success criteria

- Typecheck passes.
- `buildGroundedContext` returns additional `sources` entries for the always-on checks when corresponding rows exist.
- A manager asking "what's broken?" or "who hasn't signed off?" gets an itemized answer instead of counts.
