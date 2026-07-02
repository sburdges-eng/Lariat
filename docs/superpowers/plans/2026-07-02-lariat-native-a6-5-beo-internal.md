# LariatNative A6.5 — BEO internal surfaces (operator side)

Swift port of the web BEO operator surfaces into `LariatNative`. The web feature is
the spec; parity oracles are the `tests/js/test-beo*` suites pinned below. Branch:
`feat/lariat-native-a6-5-beo` (worktree `worktrees/a6-5-beo`, cut from `origin/main`
@ 881b16d).

## Gap-audit result

Nothing BEO exists natively today (`grep -ri beo LariatNative/Sources` → only the
Command-Center rollup's `beo_events` COUNT). All three boards below are fresh ports.

### Tier choice (documented per scope contract)

New sidebar tier `.beo` (raw value `"BEO"`) — the surface is neither `.manager`
(different operator: catering/KM, not GM analytics) nor `.foh`. Three descriptors:

| id | title | writes |
|----|-------|--------|
| `beo.board` | Parties | PIN-gated audited writes (events, lines, courses, prep tasks) |
| `beo.fireSchedule` | Fire schedule | read-only (PUBLIC on web — wall-iPad rollup) |
| `beo.prepHistory` | Past prep | read-only |

## Web sources ported (origin/main is the system of record)

- `app/api/beo/route.js` — GET (events + prep_tasks + line_items, location-scoped,
  line_items via correlated subquery) + POST actions `event`, `update_event`, `line`,
  `update_line`, `delete_line`, `prep`, `prep_done`, `delete_event`.
- `app/api/beo/courses/route.js` + `app/api/beo/courses/[id]/route.js` — course list /
  create / patch / delete, `beo_course` audit entity, 404-at-location, 422 validation.
- `app/api/beo/fire-schedule/route.js` — date path + `event_id` path (echoes the
  event's own `event_date`; malformed event_id falls through to the date path).
- `app/api/beo/prep-history/route.js` — item matches (cap 50 items/request) + recent.
- `app/api/beo/cascade/route.js` — event-scoped order guide / prep demands / unmapped;
  engine errors return an error string INSIDE a success payload (banner, not failure).
- `lib/beoCourses.ts`, `lib/beoFireSchedule.ts`, `lib/beoPrepHistory.ts`,
  `lib/beoCascade.ts` (spawn wrapper — see cascade note), plus the worksheet totals
  math embedded in `app/beo/BeoBoard.tsx` (`roundMoney`, subtotal/tax/fee/total,
  consecutive-category grouping).
- UI: `BeoBoard.tsx`, `CoursePanel.jsx`, `EventFirePanel.jsx`,
  `EventOrderGuidePanel.jsx`, `EventPrepPanel.jsx`, `UnmappedCallout.jsx`,
  `PrepHistoryPanel.jsx`.

## Edge blockers confirmed NOT ported

- `app/beo/share/[token]` page, `app/api/beo/share/[token]` + `/sign` routes,
  `app/api/beo/[id]/share-token`, `lib/beoShare.ts`, `beo_signatures` writes, and the
  BeoBoard "Share with client" affordance. Confirmed EDGE BLOCKER — guest-facing,
  token-authenticated over HTTP; stays web-only. The `share_token` columns are read
  as-is and never written natively.
- Oracles skipped for that reason: `test-beo-share.mjs`, `test-beo-share-api.mjs`,
  `test-beo-share-rules.mjs`.

## Deliberately deferred (with reasons)

- `lib/beoEstimate.ts` + `lib/beoFoodCost.ts` + `/beo/[id]/estimate` page
  (`test-beo-estimate.mjs`, `test-beo-food-cost.mjs`): outside the binding lib
  enumeration for this wave, and `EstimateDocument` is shared verbatim with the
  client share surface (edge). Follow-up wave if wanted.
- `test-beo-get-prepare-reuse.mjs` and the 50-events scaling test's WeakMap
  statement-cache concern: Node `better-sqlite3` mechanics; GRDB caches prepared
  statements internally. The *behavioral* part (all rows returned, correctly
  associated, one bound location parameter) is covered by repository tests.
- `test-beo-prep-history-context.mjs`: exercises `lib/kitchenAssistantContext.ts`
  rendering (kitchen-assistant feature area, not BEO board). Not ported.
- Temp-PIN relaxation (`beo.fire_at_edit` scope for course_id-only line patches and
  course CRUD; `test-beo-pin-gate-fixes.mjs`): the native gate model is a
  manager-PIN *session* (PinSessionStore + PinEntrySheet), not per-request cookies.
  All native BEO writes sit behind the master-PIN session — strictly TIGHTER than
  web (never weaker). The rules module still ports `parseCourseIdPatch` etc. in
  full. Revisit if native ever grows a temp-PIN session.

## Cascade strategy (and the #369 WATCH note)

`lib/beoCascade.ts` is itself a spawn wrapper around `scripts/beo_cascade_cli.py`
(which drives `scripts/lib/bom_expand.py` + `beo_pull.py` over `recipes/` +
`menus/beo_recipe_map.csv`). The Swift port mirrors that architecture 1:1:
`BeoCascadeClient` ports the wrapper (payload keys, 15 s timeout, `CascadeError`
codes `timeout` / `spawn_failed` / `bad_json` / `bad_shape` / `cli_error` /
`exit_N`, empty-line-items short-circuit, field coercion) and shells to the same
CLI (`LARIAT_PYTHON` / `LARIAT_ROOT` env parity). The Python engine stays the
single source of truth for cascade numbers — deliberately NOT re-implemented in
Swift.

**WATCH — web PR #369 (open, unmerged)** touches BEO location scoping + cascade
conversions + on-hand wiring. This port is against origin/main. If #369 merges:
re-sync `BeoCascadeClient` + `BeoCascadeRepository` (payload/response fields,
on-hand inventory wiring) and the location-scope tests. Because the engine stays
in Python, engine-math changes flow through automatically; only wrapper/route
level changes need re-porting.

## Layers

1. **LariatModel** (pure, parity tests first)
   - `Compute/BeoCourseRules.swift` ← `lib/beoCourses.ts` (`isIso8601Utc`,
     `validateCoursePayload`, `nextSortOrder`, `parseCourseIdPatch`, `isStationSlug`)
   - `Compute/BeoFireScheduleCompute.swift` ← `lib/beoFireSchedule.ts`
     (`resolveSchedule`, `ageBucketFor`, 30-min yellow threshold, fail-closed red)
   - `Compute/BeoPrepHistoryCompute.swift` ← pure parts of `lib/beoPrepHistory.ts`
     (`clampLimit` 5/25, `parseAmountQty` incl. comma thousands + trailing unit,
     `median`, bidirectional recipe-name match with MIN len 3)
   - `Compute/BeoWorksheetCompute.swift` ← BeoBoard totals (`roundMoney` =
     `Math.round(n*100)/100`, line totals, subtotal, tax = subtotal×rate,
     fee = subtotal×pct/100, grand total, consecutive-category grouping)
   - `BeoRecords.swift` — row types (snake_case CodingKeys) + typed `BeoWriteError`
     pinning web statuses (400 badRequest / 404 notFound / 422 unprocessable)
   - `BeoCascadeClient.swift` — spawn wrapper port (non-Compute; process I/O),
     injectable runner for tests
2. **LariatDB** (in-memory-style GRDB fixture w/ REAL web DDL, tests first)
   - `BeoBoardRepository` (route.js GET + 8 POST actions), `BeoCoursesRepository`,
     `BeoFireScheduleRepository`, `BeoPrepHistoryRepository`, `BeoCascadeRepository`
   - Fixture `BeoTestSupport.swift`: `beo_events` (incl. min_spend/share columns),
     `beo_line_items` (incl. migrated prep-sheet cols + `course_id` FK ON DELETE SET
     NULL), `beo_prep_tasks`, `beo_courses` (incl. `station_id`), `beo_prep_history`,
     `audit_events` — DDL copied from `lib/db.ts` as-is; no native migrations.
3. **LariatApp** — `BeoBoardView(+VM)`, `BeoFireScheduleView(+VM)`,
   `BeoPrepHistoryView(+VM)`, `BeoFeatures.swift`; +1 tier & 3 descriptors in
   `FeatureCatalog`, +3 lines in `FeatureRegistry`, registry tests extended.

## Audit posture (pinned by repository tests)

- Every regulated write posts `audit_events` in the SAME transaction
  (`AuditedWriteRunner` + `AuditEventWriter`). Entities/actions/payload keys match
  the web exactly: `beo_events` insert/update/delete, `beo_line_items`
  insert/update/delete, `beo_prep_tasks` insert/update, `beo_course`
  insert/update/delete (note: web uses singular `beo_course` for courses).
- Divergences (asserted in tests): `actor_source = native_mac` (web: `api` on
  /api/beo, `manager_ui` on courses); NO idempotency layer (a repeated create call
  inserts a second row — asserted); reads are open natively (web GET /api/beo is
  PIN-gated; native precedent keeps reads open, writes session-gated).
- Rule failures throw typed `BeoWriteError` BEFORE any write.
- Location scoping: `LocationScope.resolve()` default; line-item mutations scoped
  via the parent-event subquery exactly as web (Bundle-H T4).
- Money: `unit_cost`/`min_spend` REAL dollars, `tax_rate` REAL fraction (0.0675
  default), `service_fee_pct` REAL percent (20 default) — Doubles end to end,
  rounded via the ported `roundMoney` only at display/total boundaries (web parity).

## Oracle map (operator-side cases → native tests)

| web oracle | native test |
|---|---|
| test-beo-courses-rules.mjs (4 describes, 20 cases) | BeoCourseRulesTests |
| test-beo-fire-schedule-rules.mjs (resolveSchedule 6, ageBucketFor 6) | BeoFireScheduleComputeTests |
| test-beo-cascade.mjs (3 cases) | BeoCascadeClientTests (runner-injected) |
| test-beo-worksheet.mjs (GET shape, event/line/prep actions, defaults, FK cascades, 400s) | BeoBoardRepositoryTests |
| test-beo-update-event-partial-patch.mjs (3 partial-patch + 7 min_spend) | BeoBoardRepositoryTests |
| test-beo-line-location-scope.mjs (5) | BeoBoardRepositoryTests |
| test-beo-courses-api.mjs (POST/PATCH/DELETE/audit/course_id binding, 14) | BeoCoursesRepositoryTests |
| test-beo-fire-schedule-api.mjs (date path 6 + event_id path 4) | BeoFireScheduleRepositoryTests |
| test-beo-prep-history-api.mjs (lib 6 + route 6) | BeoPrepHistoryRepositoryTests |
| test-beo-cascade-api.mjs (400×4, 404×2, empty, unmapped passthrough, shape) | BeoCascadeRepositoryTests |
| (none on web) getPrepMedianForItems / getRecipePrepHistory | native tests authored against `lib/beoPrepHistory.ts` code — documented |
| test-beo-get-many-events.mjs | behavioral subset in BeoBoardRepositoryTests (50-event association) |

Schema-migration cases inside test-beo-worksheet.mjs (initSchema/migrateLegacyColumns)
are web-owned — natively the schema is read as-is; fixture mirrors the final DDL.
