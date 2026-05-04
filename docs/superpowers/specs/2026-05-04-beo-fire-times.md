# SPEC: BEO course fire-times + per-station rollup + temp PINs

**Status:** awaiting approval (skill: spec-plan-tdd, step 2/5)
**Slug:** `beo-fire-times`
**Owner:** sean
**Companion plan:** `docs/superpowers/plans/2026-05-04-beo-fire-times.md` (next)

---

## Goal

Banquet event managers schedule courses to "fire" (be on the pass for service) at specific clock times. Today, BEO line items carry an unstructured `order_time` per line and there is no concept of a course. This spec adds (a) a normalized `beo_courses` table grouping line items into manager-defined courses, (b) a per-course `fire_at` clock time with an audio/visual cue when the time hits, (c) a kitchen-wide "tonight rollup" page that lists every course due tonight across all booked events, sorted by fire time and broken out per station, and (d) a temp-PIN subsystem so a manager can issue a 1-shift authority PIN to a sous chef without sharing the master PIN.

The user-visible win: a single screen any cook can read tells them what's coming, when, and in which station — replacing the current verbal-relay-from-the-manager pattern.

## Non-goals

- BEO event creation flow (already exists at `app/beo/`).
- Beverage/bar prep on the same board.
- Auto-suggesting fire times from cook-time estimates — manager enters the clock time manually.
- Cross-event prep batching ("3 events × 50 brisket portions = one 150-portion batch") — Phase 2.
- Push notifications when fire-time approaches — the audio/visual cue is in-page only.
- Per-line fire times — fire is a course-level decision; a line inherits its course's fire_at.
- Multi-tenant temp-PIN sharing across locations — one location at a time.
- Recovering / re-displaying a temp PIN after issuance (tell-the-cook-then-forget; if lost, revoke + reissue).

## User-facing surface

### A. Course editor (extends `app/beo/BeoBoard.jsx`)

- Existing line-item rows get a "Course" dropdown bound to that event's courses.
- New "Add course" button per event opens an inline editor: course label (free-text, e.g. "Amuse", "First", "Entree", "Dessert"), fire time (HH:MM picker, local clock), optional notes.
- Editing fire_at on a course updates all child lines' inherited fire_at on the rollup page (no schema duplication — fire_at lives on the course).
- **PIN-gated** (existing `lariat_pin_ok` cookie OR a valid temp-PIN cookie scoped `beo.fire_at_edit`).

### B. Tonight rollup (new page `app/prep/fire-schedule/page.jsx`)

- Path: `/prep/fire-schedule`. Reachable from existing `/prep/` hub tile.
- Layout: per-station columns (grill, sides, bar, ...) reading from `dish_components.station_id` joined through line items.
- Each card = one course, ordered top-down by `fire_at`.
- Card shows: event name, course label, fire time, line items + qty, age coloring (green > 30min away, yellow ≤30min, **red on/past fire_at** — matches v1 KDS protocol §2 age-coloring).
- **Audio cue** at fire time: short Web Audio API tone (~440Hz, 250ms). Fires once per course per session; suppressed if cook tapped "ack" on that card.
- **Visual cue** at fire time: card background pulses red for 5 seconds, then settles into the standard red overdue state.
- Polls every 15s. No SSE/WS in v1.
- Read-only (no PIN required) — line cooks read it, managers don't edit from it.

### C. Temp-PIN issuance (new page `app/management/temp-pins/page.jsx` + API)

- Manager (must hold the master PIN cookie) lands on the page, fills in: label (e.g. "Sous chef Marco — Friday banquet"), expires_at (datetime picker, default = end of current shift), scopes (multi-select of available scope keys).
- POST `/api/auth/temp-pin/issue` returns `{ pin: "8327", expires_at, scopes }`. The 4–6 digit PIN is shown ONCE on screen; navigating away discards it.
- Sous chef goes to `/login-pin`, enters the temp PIN, gets a `lariat_temp_pin_ok` cookie scoped to the same set.
- Manager page also lists active temp PINs (label, scopes, expires_at, "Revoke" button).
- All issuance and use is audited.

### D. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/beo/courses` | PIN or temp(`beo.fire_at_edit`) | create/update a course (`{event_id, course_label, fire_at, notes?}`) |
| DELETE | `/api/beo/courses/:id` | same | delete a course; child line_items have `course_id` set to NULL |
| PATCH | `/api/beo/line-items/:id` | same | extends existing PATCH to accept `course_id` |
| GET | `/api/beo/fire-schedule?date=YYYY-MM-DD&location=...` | none | tonight-rollup payload, joined to dish_components for station |
| POST | `/api/auth/temp-pin/issue` | PIN | mint a temp pin |
| GET | `/api/auth/temp-pin/list` | PIN | list active temp pins |
| POST | `/api/auth/temp-pin/revoke` | PIN | revoke by id |
| POST | `/api/auth/temp-pin/login` | none | exchange a temp PIN string for a `lariat_temp_pin_ok` cookie |

### Example: GET /api/beo/fire-schedule?date=2026-05-04

```json
{
  "date": "2026-05-04",
  "location_id": "default",
  "stations": [
    {
      "station_id": "grill",
      "courses": [
        {
          "id": 17,
          "event_id": 42,
          "event_title": "Hendricks Wedding",
          "course_label": "Entree",
          "fire_at": "2026-05-04T19:30:00.000Z",
          "lines": [
            { "id": 901, "item_name": "Smoked Brisket", "quantity": 80, "prep_notes": "no sauce on side" },
            { "id": 902, "item_name": "Half Chicken", "quantity": 40 }
          ]
        }
      ]
    }
  ]
}
```

`fire_at` is canonical ISO-8601 UTC (round-trips through Date) — same strictness rule as the KDS protocol §2 (matches the existing JS↔Swift parser convention so the same client code can render either feed).

## Data model deltas

### New table: `beo_courses`

```sql
CREATE TABLE IF NOT EXISTS beo_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  location_id TEXT NOT NULL DEFAULT 'default',
  course_label TEXT NOT NULL,
  fire_at TEXT NOT NULL,          -- ISO-8601 UTC, canonical form
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_beo_courses_loc_fire
  ON beo_courses(location_id, fire_at);
CREATE INDEX IF NOT EXISTS idx_beo_courses_event
  ON beo_courses(event_id, sort_order);
```

### Migration on `beo_line_items`

```sql
ALTER TABLE beo_line_items ADD COLUMN course_id INTEGER
  REFERENCES beo_courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_beo_line_course ON beo_line_items(course_id);
```

`course_id` is nullable for backward compat. Pre-existing line items have NULL until a manager assigns a course. The rollup page only includes lines whose course_id is non-NULL (no synthetic "uncoursed" bucket in v1).

### New table: `temp_pins`

```sql
CREATE TABLE IF NOT EXISTS temp_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL DEFAULT 'default',
  pin_hash TEXT NOT NULL UNIQUE,        -- SHA-256(pin); raw PIN never persisted
  label TEXT NOT NULL,                  -- "Sous chef Marco — Fri banquet"
  scopes_json TEXT NOT NULL,            -- JSON array, e.g. ["beo.fire_at_edit"]
  issued_by TEXT,                       -- master-PIN cookie subject (or NULL pre-named-actors)
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,             -- ISO-8601 UTC; rejected after this
  revoked_at TEXT                       -- non-NULL = revoked, no longer valid
);
CREATE INDEX IF NOT EXISTS idx_temp_pins_active
  ON temp_pins(location_id, expires_at)
  WHERE revoked_at IS NULL;
```

### Extension to `lib/pin.ts`

New helper `hasPinOrTempPin(req, scope)`:
- Returns true if the existing master PIN cookie is valid, **OR** if a `lariat_temp_pin_ok` cookie is present, validates against `temp_pins` (not revoked, not expired), and the row's `scopes_json` includes `scope`.
- Existing `hasPinCookie(req)` is unchanged — surfaces that need *master-only* (e.g. `/api/auth/temp-pin/issue`) keep using it.

## Invariants

1. **`fire_at` is canonical ISO-8601 UTC.** Any non-canonical input is rejected at write time. Matches the existing KDS protocol §2 strictness.
2. **A line item's effective fire time = its course's `fire_at`.** Line items have NO `fire_at` column. Drift is structurally impossible.
3. **Audit row is in the same transaction as the write.** `beo_courses` insert/update/delete writes a `audit_events` row with `entity='beo_course'`. Per `docs/PATTERNS.md §3`.
4. **Temp PIN raw value never persisted.** Only `SHA-256(pin)` is stored. The raw PIN is shown ONCE in the issuance response and is unrecoverable thereafter.
5. **Temp PIN cookie validity = (not revoked AND not expired AND scopes include the asked-for scope) at every check.** Cached cookie does not bypass the DB check; we hit `temp_pins` on every gated request. (PIN gates run on small surfaces — the cost is negligible.)
6. **Audio cue fires at most once per course per browser session.** Backed by an in-memory Set keyed on course id.
7. **The rollup endpoint is read-only and unauthenticated.** Same reasoning as `/api/kds/tickets`. No PII in the response.

## Open questions (flag for user before SPEC commit)

These are choices I've baked in but want explicit consent on before locking:

1. **Course label is free-text** rather than a fixed enum (`amuse | app | entree | dessert`). Free-text matches how operators talk about it ("the cocktail hour bites", "the late-night menu") but loses the ability to render a "Course Order: Entree comes after App" UX hint. Pick: **free-text**, with `sort_order` as the only ordering signal. Override?
2. **Audio cue is a 440Hz tone**, not a custom sound the operator uploads. Saves us from wiring an audio-asset pipeline. Override?
3. **Temp PIN length is operator-controlled** (4–6 digits), default 4. Cooks need to type these on iPads under pressure; longer = more secure but slower to enter. Override?
4. **Scopes are coarse string keys** (e.g. `beo.fire_at_edit`) rather than a full RBAC system. Five possible scopes max in v1. Override?
5. **The fire-schedule page polls every 15s** rather than SSE. Matches the KDS v1 polling cadence. Override?
