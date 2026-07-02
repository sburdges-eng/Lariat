# LariatNative A6.4 — Shows domain port (tonight, archive, box-office, settlement, sound, stage)

Branch: `feat/lariat-native-a6-4-shows`. One wave, new `.shows` FeatureTier ("Shows").
Web is the spec; schema read as-is (fixtures mirror `lib/db.ts` DDL, no migrations).

## Gap audit (web sources read in full)

| Web surface | Routes | Libs | Oracles |
|---|---|---|---|
| /shows/tonight | GET /api/shows/tonight, POST /api/shows/[id]/capacity | showsTonight.ts, showStatus.ts, showsRepo.ts | test-shows-tonight-rules (40), test-shows-tonight-api (11), test-show-capacity-api (10), test-show-status (12), test-shows-repo (8), test-shows-api (7) |
| /shows/archive | GET /api/shows?op=archive | showsRepo.ts | test-shows-repo, test-shows-api |
| /shows/[id]/box-office | GET/POST box-office, PATCH [lineId] | boxOfficeRepo.ts | test-box-office-repo (15), test-box-office-dice-idempotency (9), test-box-office-route-idempotency (5, HTTP wrapper) |
| /shows/[id]/settlement | GET/PUT deal, GET settlement, GET settlement/pdf | settlementRepo.ts, dealPoints.ts, settlementPrint.ts | test-settlement-repo (8), test-settlement-route (8), test-settlement-deal-parser (20), test-settlement-pdf (17), test-schema-show-deals (3) |
| /shows/[id]/sound | GET/POST sound, PATCH/DELETE [sceneId], GET/POST sound/spl | soundRepo.ts, splTelemetry.ts | test-sound-repo (20), test-sound-spl-api (11), test-spl-telemetry-rules (16) |
| /shows/[id]/stage | GET/POST stage | stageRepo.ts | test-stage-repo.mjs is EMPTY (0 bytes) on web — native tests authored from the lib/route code |

## Board split (decision)

The four `/shows/[id]/*` pages are separate tab pages sharing only a header/TabStrip;
each has an independent route + repo + write posture. Native ships them as separate
boards with a shared show picker, under one `.shows` tier:

- `shows.tonight` — Tonight · Live composed read (show, previous show, stage/sound
  summaries, box-office rollup, attendance vs effective capacity) + capacity
  override write + upcoming-pipeline strip (`pipelineStage` state machine, exact
  top-down rules 1–6 with greenish guards).
- `shows.archive` — shows_archive search (band LIKE, era filter, eras list),
  read-only, `.searchable`.
- `shows.boxOffice` — lines list + summary + completeness; walkup/comp/etc. line
  create + door mark-scanned (regulated, DB audit stream, same-tx).
- `shows.settlement` — MONEY-CRITICAL. Int-cents settlement join + venue-favorable
  `floor(overage × vsPct)` bonus; deal upsert (insert → `insert`, re-write →
  `correction` audit); print COMPUTATION as monospaced text preview.
- `shows.sound` — scenes CRUD + SPL telemetry (append/list/summarize/threshold),
  file-stream audit inside the write tx.
- `shows.stage` — stage_setups UPSERT, KNOWN_ROOM_CONFIGS catalog ported verbatim,
  file-stream audit inside the write tx.

## Audit posture (mirrors web exactly)

| Write | Web stream | Native |
|---|---|---|
| box_office_lines insert / mark_scanned / dice upsert | `audit_events` DB stream, same tx | `AuditEventWriter` inside `AuditedWriteRunner` |
| show_deals upsert | `audit_events`, action insert/correction | same |
| capacity override, stage upsert, sound scene create/update/delete, spl append | file JSONL (`lib/auditLog.mjs`) inside the db tx | `ShowsAuditLogger` JSONL appended inside the GRDB write block (throw → rollback) |

`actor_source`: web uses `box_office` / `dice_ingest` / `manager_ui`; native writes
tag `native_mac` per the established LariatNative convention (documented divergence).
PIN: `/shows` + `/api/shows` are PIN-gated on web (middleware SENSITIVE_PREFIXES);
native mirrors the Morning read-gate (whole-board PIN session when gate configured)
plus per-write `ManagementWrite.requireSession`.

## Money conventions (per column)

| Column | Web type | Native |
|---|---|---|
| shows.price | REAL dollars | `Double?` dollars (display only) |
| box_office_lines.face_price / fees | REAL dollars | `Double?` dollars; settlement converts at read boundary `Int(round(x*qty*100))` |
| box_office_lines.qty | INTEGER | `Int` |
| show_deals.guarantee_cents / buyout_cents / costs_off_top_json[].cents | INTEGER cents | `Int` cents |
| show_deals.vs_pct_after_costs | REAL 0–1 | `Double?` |
| toast_sales_daily.net_sales | REAL dollars | `Int` cents at read boundary (`round(sum*100)`) |
| Tonight box-office rollup | dollars rounded to cents (`roundCents`) | `Double` dollars, same rounding |
| vs bonus | `Math.floor(overage × pct)` — venue-favorable | `Int(floor(...))`, byte-exact |

Observed web quirks ported faithfully (flagged, not fixed):
- `showsTonight.summarizeBoxOffice` adds `fees` once per line; `settlementRepo`
  multiplies fees by qty; `boxOfficeRepo.summarize` counts revenue without fees.
  Three different fee semantics — each surface ports its own.
- Tonight's `parseRunOfShow` accepts `{time,label}`/`{at,text}`/strings but the
  Stage board writes `{t,what,who}` — stage-authored entries are skipped on the
  web Tonight page too.

## Deliberately deferred / N-A

- `withIdempotency` (Idempotency-Key HTTP replay wrapper): no native transport →
  no port; divergence asserted here. DICE natural-key idempotency (partial UNIQUE
  on (source, external_ref)) IS ported — it is the money-critical contract.
- HTML/CSP/auto-print aspects of settlement PDF (`renderSettlementHtml`,
  H7 headers, XSS escaping): web-only; native ports the computation and renders a
  monospaced text preview. macOS print integration = later H6 (deferred-cosmetic).
- Weekly settlement digest (`renderDigestHtml` + `weekRange`): script surface
  (`test-weekly-*`, outside the `test-settlement*` oracle set), not a board.
- Shows/archive xlsx ingest (`test-shows-ingest.mjs`): web `npm run ingest:shows`
  stays the only mutation path for shows rows; native reads ingested rows.
- DICE bulk import trigger: repo method ported + tested; not exposed in native UI
  (script/edge concern — edge-blocker candidate for public DICE webhook later).
