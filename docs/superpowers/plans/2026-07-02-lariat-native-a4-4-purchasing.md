# LariatNative A4.4 — Purchasing wave (`.purchasing` tier, 3 boards)

Port the web **purchasing** feature area to LariatNative. One worktree
(`worktrees/a4-4-purchasing`), one branch (`feat/lariat-native-a4-4-purchasing`),
Swift-only changes under `LariatNative/` plus this plan doc.

## Web sources of truth

| Web source | Role |
|---|---|
| `lib/vendorCompare.ts` | Sysco vs Shamrock normalized price compare (pure read + compute) |
| `lib/vendorMapping.ts` | Catalog search / coverage / single-vendor masters (read layer) |
| `lib/vendorMappingRepo.ts` | PIN-gated pair/attach writes with audit (write layer) |
| `lib/ingredientKey.ts` | `deriveMasterId` (normalize + `_` join) |
| `lib/orderGuideEnrichment.ts` | Preferred/lock/mismatch badges for the hub table |
| `app/purchasing/page.jsx` | Order-guide hub (read-only, 200-item limit) |
| `app/purchasing/compare/page.jsx` + `CompareActions.jsx` + `AttachVendorActions.jsx` | Compare board + preferred/lock writes + attach |
| `app/purchasing/link/page.jsx` + `LinkPairForm.jsx` | Link-vendors pair form |
| `app/api/purchasing/**` | Route semantics (422/409/404, PIN gate) |

Parity oracles (every case ported):
`tests/js/test-vendor-compare.mjs` (5), `tests/js/test-vendor-mapping.mjs` (5),
`tests/js/test-vendor-mapping-repo.mjs` (3), `tests/js/test-vendor-mapping-api.mjs`
(3, adapted to repository level — native has no HTTP layer).

## Boards

1. **`purchasing.compare` — Vendor compare.** `VendorCompareCompute`
   (`computeComparableUnitPrice`, `pickTargetUnit`, `pickCheaper`) +
   `VendorCompareRepository.listVendorCompareRows`. The compare-board *write*
   (preferred_vendor / quality_locked / quality_lock_reason) REUSES
   `IngredientMastersRepository.updateMaster` — no duplicate write path.
   Attach-missing-vendor lives here (web `AttachVendorActions` renders on the
   compare page) via `VendorMappingWriteRepository.attachCatalogRow`.
2. **`purchasing.link` — Link vendors.** `VendorMappingCompute` (`deriveMasterId`
   reusing `IngredientKey.normalize`, catalog-key round-trip) +
   `VendorMappingRepository` reads (`searchVendorCatalog`,
   `listSingleVendorMasters`, `summarizeMappingCoverage`) +
   `VendorMappingWriteRepository.pairCatalogRows` (one txn: master upsert +
   2 confirmed maps + 2 vendor_prices UPDATEs + 4 audit events).
3. **`purchasing.orderGuide` — Purchasing hub (read-only).** Order-guide table
   (LIMIT 200, `ORDER BY vendor, ingredient`) enriched per
   `lib/orderGuideEnrichment.ts` (Pref / Locked / Mismatch badges).

## Conventions (binding, same as A1–A4.2)

- **Money:** `vendor_prices` / `order_guide_items` money columns are REAL
  **dollars** — kept as `Double` dollars end to end. No implicit conversion.
- **Reuse:** `Compute/UnitConvert.swift` (A4.2) for normalizeUnit / unitDimension /
  convertQty; `Compute/IngredientKey.swift` (A4.1) for `normalizeIngredientKey`.
  Neither is re-ported.
- **Schema read as-is:** no native migrations. Test fixtures CREATE the exact
  web-DDL tables they touch (`vendor_prices` incl. the ALTER-added
  `reconciled_unit_price`/`master_id`, `ingredient_masters`, `ingredient_maps`,
  `ingredient_densities`, `order_guide_items`, `audit_events`).
- **Audit parity:** every regulated write emits its `audit_events` rows in the
  SAME transaction (`AuditedWriteRunner` + `AuditEventWriter`); rule failures
  throw BEFORE any write/audit. Event count + payload shapes mirror
  `lib/vendorMappingRepo.ts` (pair = 4 events, attach = 2).
- **Deliberate divergences (asserted in tests, not "fixed"):**
  `actor_source = native_mac` (web passes `manager_ui`/api); typed
  `VendorMappingWriteError` cases instead of HTTP 422/409/404; no idempotency
  layer.
- **PIN:** writes PIN-gated per-write in the VMs (`ManagementWrite.requireSession`
  + `PinSessionStore` + `PinEntrySheet`) — native analog of the web
  `requirePin` on every `/api/purchasing` route. Reads open (costing precedent).
- **A0 registration:** new `.purchasing` `FeatureTier`, one `FeatureDescriptor`
  per board in `FeatureCatalog.all`, one `FeatureModule` each in
  `PurchasingFeatures.swift` (writeDatabase guard → view, else `TileDegrade`),
  registry append, `FeatureRegistryTests` assertions. `LariatApp.swift` and hub
  views untouched.
- **UX:** `LariatTheme` tokens, `EmptyState`, labeled `ProgressView`,
  `.searchable` client-side filters on catalog/compare lists.

## Known web quirk (ported faithfully, flagged, not fixed)

`computeComparableUnitPrice` converts a **price** ($/unit) with `convertQty` as
if it were a quantity, so cross-unit conversion multiplies where a per-unit
price should divide (e.g. $/oz → $/lb yields price÷16 instead of ×16). The
`pickTargetUnit` design makes this mostly unreachable in practice (weight
compares always target `lb` and equal-unit compares skip conversion), but it is
reachable for mixed weight units. Ported byte-faithfully per HACCP/rule-parity
policy; surfaced in the wave report as a web-side fix candidate.

## Order of work (resilience order, commit per layer)

1. Plan doc (this file).
2. `LariatModel`: `VendorCompareCompute`, `VendorMappingCompute`,
   `PurchasingRecords` (+ write-error enum, `WriteErrorMapper` untouched —
   errors surface via `LocalizedError`).
3. `LariatDB`: `VendorCompareRepository`, `VendorMappingRepository`,
   `VendorMappingWriteRepository`, `PurchasingOrderGuideRepository`.
4. Tests: `VendorCompareComputeTests`, `VendorMappingComputeTests` (model);
   `VendorCompareRepositoryTests`, `VendorMappingRepositoryTests`,
   `VendorMappingWriteRepositoryTests`, `PurchasingOrderGuideRepositoryTests` (db).
5. `LariatApp`: 3 View+ViewModel pairs, `PurchasingFeatures.swift`,
   catalog/registry/registry-test appends.
6. Full `swift build && swift test`; scope check
   (`git diff --name-status origin/main` = permitted files only).
