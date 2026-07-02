# LariatNative A4.3 — Menu-engineering wave (dish-cost bridge + 3 boards)

Date: 2026-07-02 · Branch: `feat/lariat-native-a4-3-menueng` · One feature area: `menu-engineering`

## Scope

Port the web menu-engineering surface to LariatNative:

| Task | Web source (spec) | Native artifacts |
|------|-------------------|------------------|
| T1 dish-cost bridge | `lib/dishCostBridge.ts`, `lib/menuEngineering.ts` | `LariatModel/Compute/DishCostBridge.swift` (pure), `LariatModel/DishBridgeRecipeLoader.swift`, `CostingRepository` bridge fetch (resolves the `CAST(NULL AS REAL)` staging gap) |
| T2 margin-deltas board | `app/menu-engineering/margin-deltas/page.jsx` | `MarginDeltasView.swift` (+VM), zero-state counts extension. Compute + repository ALREADY exist — not re-ported. |
| T3 menu-engineering hub | `app/menu-engineering/page.tsx` | `MenuEngineeringView.swift` (+VM), `MenuEngineeringRepository.swift` |
| T4 dish-components editor | `app/menu-engineering/components/*`, `app/api/dish-components/route.ts`, `lib/dishComponents.ts`, `lib/dishComponentsRepo.ts` | `DishComponentRecords.swift`, `Compute/DishComponentValidation.swift`, `DishComponentsRepository.swift`, `DishComponentsView.swift` (+VM) |
| T5 missing compute tests | `tests/js/test-margin-deltas.mjs` cases 7–8 | `MarginDeltasComputeTests` additions |

## Key spec findings (read from the web code, which is authoritative)

1. **`lib/dishCostBridge.ts` does NOT skip recipe components.** The dispatcher brief said
   "recipe-typed components skipped in M1.1" — that describes `lib/marginDeltas.ts`, not the
   bridge. The current bridge resolves BOTH `recipe` components (via `recipe_costs`
   `cost_per_yield_unit` × unit-converted qty) and `vendor_item` components (via
   `vendor_prices` latest-`imported_at`, falling back to non-placeholder
   `order_guide_items`). The file is the spec → the Swift port mirrors the file.
2. **Recipes discovery layer** (`recipes.menu_items[]`) comes from `data/cache/recipes.json`
   (`lib/data.ts getRecipes()`), not the DB. Native mirrors the existing `StationCatalog`
   precedent with a dedicated loader that returns `[]` on any failure (web parity).
3. **`/api/dish-components` writes NO audit_events** and CLIPS over-length fields
   (80/200/24/500) instead of rejecting. Writes are wrapped in one transaction. The web
   route uses `withIdempotency`; native has no idempotency layer (documented divergence,
   per the ingredient-masters precedent).
4. **Fixture constraint**: `Fixtures.swift` (shared, not editable in this wave) has
   `dish_components` + empty `vendor_prices` but NO `recipe_costs` / `order_guide_items`
   tables. `CostingRepository`'s bridge fetch therefore treats a missing bridge table as an
   empty input (`db.tableExists` guard) so pre-existing fixtures and pre-migration DBs keep
   working. New bridge repo tests use their own full-schema fixture.

## Parity oracles

- `tests/js/test-dish-cost-bridge.mjs` — every case ported (pure cases → compute tests;
  SQL-dependent cases → new `CostingBridgeRepositoryTests`).
- `tests/js/test-margin-deltas.mjs` cases 7 (location scoping) and 8 (windowDays clamp) —
  compute-level analogs added (repository-level versions already exist).
- `app/api/dish-components/route.ts` + `lib/dishComponents.ts` — no dedicated web route
  test exists; native tests are authored directly against the web code paths (documented).

## Registration

A0 self-registration only: one `FeatureModule` each in `CostingFeatures.swift`, one
`FeatureDescriptor` each in `FeatureCatalog.all` (`costing.menuEngineering` "Menu
performance", `costing.marginDeltas` "Margin moves", `costing.components` "Dish
components"), one line each in `FeatureRegistry.all`. `FeatureRegistryTests.
testCostingTierIsComplete` is updated per commit so every commit stays green.
`LariatApp.swift` / hub views untouched.

## Conventions honored

Float dollars (web float math), snake_case CodingKeys, no native migrations, LariatTheme
tokens (up = cost increase = `bad`/red; down = `ok`/green), `EmptyState`, labeled
`ProgressView`, `.searchable` on dish lists, 3 s polling like sibling VMs,
`LocationScope.resolve()` for location scoping.

## Deferred / documented

- Prep-median column on the hub board renders "—" (deferred-cosmetic; needs
  `beo_prep_history` port).
- No idempotency layer on dish-components writes (native convention; asserted in tests).
- Web PIN/middleware gating of `/menu-engineering` is not per-view gated natively
  (matches every existing costing-tier board).
