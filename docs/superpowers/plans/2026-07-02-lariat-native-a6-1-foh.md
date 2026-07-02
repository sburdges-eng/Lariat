# LariatNative A6.1 — FOH wave (floor · host · reservations · booking)

Port the web FOH group into `LariatNative` under a new `.foh` sidebar tier
("Front of house"). Web sources are the spec; every oracle case in `tests/js/`
is ported. One worktree (`worktrees/a6-1-foh`), branch
`feat/lariat-native-a6-1-foh`. Touches only `LariatNative/` + this plan doc.

## Gap audit (2026-07-02)

Nothing FOH exists natively today. The only native contact with these tables is
`CommandRepository`'s read-only `dining_tables` status/capacity rollup and
`CmdReservationRow` status counts (untouched by this wave).

| Board | Web route | API routes | lib rules | Oracles (tests/js) |
|---|---|---|---|---|
| foh.floor | `app/floor/*` | `/api/dining-tables` GET/POST, `/api/dining-tables/[id]` PATCH/DELETE | (rules inline in routes) | `test-dining-tables-api.mjs` (19 cases) |
| foh.reservations | `app/reservations/*` | `/api/reservations` GET/POST, `/api/reservations/[id]` PATCH/DELETE | (rules inline; `parseTimeTo24h` inline oracle comments in `ReservationsBoard.jsx`) | `test-reservations-api.mjs` (27 cases) |
| foh.host | `app/host/*` | `/api/host/waitlist` GET/POST, `/api/host/waitlist/[id]` PATCH | `lib/hostStand.ts` | `test-host-stand-rules.mjs` (23), `test-host-waitlist-api.mjs` (13) |
| foh.booking | `app/booking/*` | none (server component reads via `lib/showsRepo.ts`) | `lib/showStatus.ts`, `lib/showsRepo.ts` | `test-show-status.mjs` (12), `test-shows-repo.mjs` (subset used by /booking) |

## Per-board scope

### foh.floor — `dining_tables`
- **Reads**: list ORDER BY `id` ASC (TEXT → lexicographic), location-scoped;
  today's `status='booked'` reservations (`reservation_at LIKE 'YYYY-MM-DD%'`)
  for the seat-a-reservation panel (floor page query).
- **Writes** (`DiningTablesRepository`, regulated `audit_events` stream, same
  transaction — parity with `postAuditEvent` in the routes):
  - create: `id` required (trim/clip 32) → `idRequired`; `name` required
    (clip 100) → `nameRequired`; `capacity` Int 1..50 (default 2) →
    `capacityOutOfRange`; `status` in {open,seated,dirty,closed} (default
    open) → `badStatus`; x/y default 0, w/h default 1 (non-finite → default);
    notes clip 500. Duplicate `(location_id,id)` PK → `idAlreadyInUse`
    (web 409). Audit insert `entity_id=0`, payload `{id,name,capacity,status}`.
  - update: pre-checks `badStatus` / `capacityOutOfRange` (web 400 pre-tx);
    in-tx fetch by (id, loc) → `notFound` (404); set-only-if-changed for
    status/name/capacity/x/y/w/h/notes (notes: explicit null clears); empty
    set → `noChange` (400); audit update payload `{id,from_status,to_status}`.
  - delete: by (id, loc); 0 rows → `notFound`; audit delete payload `{id}`.
- **UI state machine** (FloorPlan.jsx): open → seated|dirty; seated → dirty;
  dirty → open; any non-closed → closed; closed → open. Starter set T1–T6
  (2-tops) on empty floor; duplicate-id during starter seeding is benign
  (web treats 409 as skip). Ported as pure `FloorCompute` (authored against
  UI code — no web test file; documented below).
- **actor_source**: `native_cook` — /floor is NOT in middleware's
  SENSITIVE_PREFIXES; the web board uses the `lariat_cook` localStorage
  identity (explicitly "matches the EightySixBoard pattern"). Cook identity
  required only to seat a reservation (web disables just that action).

### foh.reservations — `reservations` (× `dining_tables`)
- **Reads**: today view (`reservation_at LIKE 'date%'`), upcoming view
  (`>= date AND status NOT IN ('cancelled','completed','no_show')` LIMIT 100),
  plus API GET filters (date wins over from/to; status; ORDER BY
  reservation_at ASC, id ASC; LIMIT 500).
- **Writes** (`ReservationsRepository`, regulated `audit_events` stream):
  - create: party_name clip 200 required; party_size Int 1..50;
    reservation_at clip 64 required; table_id 64 / phone 64 / email 200 /
    notes 1000 / source 32 (default 'manual') / source_ref 200 / cook_id 64.
    Audit insert payload `{party_name,party_size,reservation_at}`.
  - update: verbs seat/complete/cancel/no_show mutually exclusive (>1 →
    `multipleVerbs`, web 400); seat sets seated_at + optional table_id;
    complete/cancel/no_show set completed_at; field edits coexist with a
    verb; set-only-if-changed; empty set → `noChange`; not-at-location →
    `notFound`. Audit update payload `{from_status,to_status,verb?}`.
    **Table wiring in the SAME transaction**: seat → linked table 'seated'
    (body table_id else row's); complete → 'dirty'; cancel → 'open' ONLY if
    reservation was already 'seated'; no_show → no touch; stale table_id
    skipped silently (no table audit). Table-side audit payload
    `{id,from_status,to_status,triggered_by}`.
  - delete: 0 rows → `notFound`; audit delete (empty payload).
- **Compute**: `ReservationsCompute` — `parseTimeTo24h` (ports the inline
  assertion table in ReservationsBoard.jsx), 12h row/hour formatting, hour
  bucketing, status counts + people-on-book.
- **actor_source**: `native_cook` (same non-PIN, `lariat_cook` posture as
  floor; Seat is the only cook-identity-required verb, matching the web's
  disabled state).

### foh.host — `waitlist_parties`
- **Compute** (`HostStandCompute`, ports `lib/hostStand.ts` 1:1):
  `sanitizeWaitlistInput` (trim/clip 80/32/500, size floor + cap 200),
  `isValidStatusTransition` (waiting → seated|left only),
  `summarizeWaitlist`, `minutesBetween` (floor, never negative, 0 on
  unparseable).
- **Reads**: waiting + today's seated/left, ORDER BY joined_at; summary.
- **Writes** (`HostWaitlistRepository`): add (sanitize-null → `invalidInput`),
  transition (id > 0; next ∈ {seated,left} else `badStatus`; 404
  `notFound`; illegal transition → `badTransition` = web 409; ISO stamps;
  `notes = COALESCE(new, old)`), each returning the fresh row.
- **Audit posture**: file-stream JSONL ONLY (`waitlist_add`,
  `waitlist_status_change` via `lib/auditLog.mjs` on web) — NO
  `audit_events` rows. Ported as `FohAuditLogger` (new; the existing
  `ManagementAuditLogger` is out of scope to edit) writing the same JSONL
  shape to `resolveManagementAuditPath()`. Pinned by a test asserting
  `audit_events` stays empty.
- **PIN**: `/host` + `/api/host` are middleware-gated on web (401 without
  PIN on GET/POST/PATCH). Native: writes PIN-gated via
  `ManagementWrite.requireSession` + `PinSessionStore` + `PinEntrySheet`
  (VendorLink precedent); reads open per native precedent. actor_source
  `native_mac` in the write context (waitlist rows carry no actor column;
  JSONL entries mirror the web's field set, which has no user field).

### foh.booking — `shows` (read-only aggregate)
- **Compute** (`ShowPipelineCompute`, ports `lib/showStatus.ts` 1:1):
  `statusColor` (token sets, numeric count semantics, "never red on
  novelty"), `pipelineStage` (Settled/On Sale/Confirmed/Offer Out/Hold/
  Inquiry rule ladder), `KNOWN_STAGES` order.
- **Reads** (`BookingRepository`, ports the three `lib/showsRepo.ts` fns
  /booking uses): `upcomingShows(today, weeks=5)` (35-day window),
  `pipelineCounts(today, weeks=52)` (includes unarchived past rows so the
  past-show Settled rule can run), `nextUpcoming(today)`. `archiveSearch`,
  `archiveEras`, `getShowById` are consumed by /shows and /playbook (other
  waves) — NOT ported here.
- **No writes** → nothing to PIN-gate (web protection is middleware-only;
  matches the native reads-open precedent documented for costing boards).
- **Money**: `shows.price` is REAL dollars → Swift `Double`, rendered with
  `formatDollars(_, decimals: 2)`; nil → '—' (web `formatDollars(null)`).
- The web page's "Next show" quick links target `/shows/[id]/*` (shows wave,
  not yet native) — next-show is shown as a text strip without links.

## Registration
- `FeatureTier` gains `case foh = "Front of house"` (appended, mirroring how
  `.purchasing` was added).
- Descriptors: `foh.floor` "Floor", `foh.host` "Host stand",
  `foh.reservations` "Reservations", `foh.booking` "Booking".
- New `FohFeatures.swift` FeatureModules; floor + reservations take
  readDB+writeDB (TileDegrade lock fallback when writeDB is nil), host takes
  readDB+writeDB (PIN writes), booking is read-only (database only).
- One `FeatureRegistry.all` line per board; `FeatureRegistryTests` gains the
  A6.1 tier-exactness test.

## Conventions (binding, from the wave brief)
- Reads via `readDB.pool.read`; audited writes via `AuditedWriteRunner` with
  in-tx `AuditEventWriter.post` ONLY where the web route posts audit_events
  (floor, reservations — yes; host — file-stream only; booking — no writes).
  Rule failures throw typed `*WriteError`s BEFORE any write.
- No migrations (each repo test seeds its own tmp DB with the web
  `lib/db.ts` schema for its tables).
- No idempotency (web `withIdempotency` on every mutating route) — recorded
  as a divergence, not ported (native has no HTTP retry layer).
- 3–5 s poll loops; LariatTheme tokens; EmptyState; labeled ProgressView;
  `.searchable` on list boards.

## Known divergences / notes (asserted in report)
1. **Idempotency keys not ported** (all four boards' writes) — native calls
   are direct method invocations, not retried HTTP.
2. **actor_source**: web routes write `'api'`; native writes `native_cook`
   (floor, reservations) / `native_mac` (host context) per program
   convention.
3. **Floor seat-a-reservation**: web does two sequential PATCHes (reservation
   seat verb, then table status). The seat verb's in-tx table wiring already
   seats the table, so the web's second PATCH always 400s 'no change' and
   surfaces a spurious banner. Native issues ONE repository call (the seat
   verb) — identical final DB state + audit rows, no spurious error.
   Web-bug candidate, reported upstream.
4. **Existing `Tests/LariatDBTests/Fixtures.swift`** creates `dining_tables`
   with a `table_name` column that does not exist in the web schema (`name`).
   Harmless for CommandRepository (selects status/capacity only) but a
   pre-existing fixture divergence — out of scope to edit here.
5. `waitlist_parties` JSONL audit entries carry no user identity on web;
   native mirrors that field set (PIN session still gates the write itself).
6. Host board polls every 30 s on web; native uses the wave-standard 5 s.
