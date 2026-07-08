# Phase III Wave A — BomExpandCompute parity (implementation plan)

> **For agentic workers:** Read `2026-07-07-lariat-native-phase-iii-status.md` first.
> TDD against JSON fixtures in `LariatNative/Tests/Fixtures/BomExpand/`.
> Opus review required before merging Wave B.

**Goal:** Port `scripts/lib/bom_expand.py` expand/aggregate/demand paths to
`LariatModel/Compute/` with fixture parity. **No App wiring, no GRDB, no spawn deletion.**

**Architecture:** Pure compute in `LariatModel/Compute/`. Fixtures loaded in tests only.
Unit tables copied verbatim from Python (D3) — do not delegate to `UnitConvert` yet.

**Branch:** `feat/lariat-native-phase-iii-bom-inprocess`
**Worktree:** `scripts/worktree.sh new cursor feat/lariat-native-phase-iii-bom-inprocess`

**Oracle:** `python3 scripts/dev/export_bom_expand_fixtures.py` then
`python3 -m unittest tests.python.test_bom_expand -v` must stay green.

---

## Global constraints

- Spec: `specs/2026-07-07-bom-expand-fixture-manifest.md`
- Kickoff symbol map: kickoff plan §3.1
- **MUST NOT modify:** `AssistantSupport.swift`, `BeoCascadeClient` default runner,
  `app/api/**`, `lib/recipeCalculator.ts`, `scripts/lib/bom_expand.py`
- Float compare at `tolerance_places: 6` (IEEE double parity with Python)
- Canary fixture `canary_queso_green_chile_bag` must **keep expecting error** — Opus review
- Run `impact` on symbols before editing if extending existing types

### Per-PR scope guard

```bash
git diff --cached --name-only   # only intended Compute + Tests paths
cd LariatNative && swift build && swift test --filter BomExpand
```

---

## Fixture → Swift test map

| Fixture ID | Swift test (proposed) | PR |
|------------|----------------------|-----|
| `cup_to_qt_sub_reference` | `testCupToQtSubReferenceConverts` | A1 |
| `gal_demand_on_qt_recipe` | `testGalDemandOnQtRecipeConverts` | A1 |
| `unit_mismatch_top` | `testUnitMismatchTopLevelThrows` | A1 |
| `single_leaf_scale` | `testSingleLeafScalesLinearly` | A2 |
| `queso_embeds_salsa` | `testQuesoPullsSalsaLeaves` | A2 |
| `queso_plus_standalone_salsa` | `testQuesoPlusStandaloneSalsaAggregates` | A2 |
| `cycle_a_b` | `testCycleDetectedThrows` | A2 |
| `unit_mismatch_sub_bag` | `testSubRecipeUnitMismatchThrows` | A2 |
| `pack_size_bag_to_qt` | `testPackSizeBagToQtResolves` | A2 |
| `graceful_skip_bad_sub` | `testGracefulSkipBadSubKeepsSiblings` | A2 |
| `explicit_sub_recipe_pin` | `testExplicitSubRecipePinBindsChild` | A2 |
| `expand_recipe_demand_half_batch` | `testExpandRecipeDemandHalfBatch` | A2 |
| `expand_recipe_demand_compound_salsa` | `testExpandRecipeDemandCompoundSalsa` | A2 |
| `manifest_warning_orphan_sub` | `testManifestWarningOrphanSub` | A2 |
| `pork_chop_marinade_2x` | `testPorkChopMarinade2xRealManifest` | A3 |
| `canary_queso_green_chile_bag` | `testCanaryQuesoGreenChileBagExpectsError` | A3 |

### Shared test harness (create in A1)

`BomExpandFixtureLoader.swift` (test target only):

- Load `Fixtures/BomExpand/{id}.json` from package test bundle or filesystem path
- Decode `manifest`, `input`, `expect`
- Helpers: `assertLeaves`, `assertNodes`, `assertError`, `assertWarnings`

---

## PR A1 — Types + convertQty (~6–8 h)

**paths_touched:**

- `LariatNative/Sources/LariatModel/Compute/BomExpandTypes.swift` (new)
- `LariatNative/Sources/LariatModel/Compute/BomExpandCompute.swift` (new — `convertQty` only)
- `LariatNative/Tests/LariatModelTests/BomExpandFixtureLoader.swift` (new)
- `LariatNative/Tests/LariatModelTests/BomExpandComputeTests.swift` (new)

**MUST NOT touch:** `RecipeManifestLoader`, expand/aggregate functions yet.

- [ ] **Step 1:** Copy Python `_VOLUME_TO_QT` / `_WEIGHT_TO_LB` into Swift constants (D3).
- [ ] **Step 2 (red):** `BomExpandTypes` — `RecipeManifest`, `BomRow`, `BomExpandError` enum
  (`unknownRecipe`, `unitMismatch`, `recipeCycle`).
- [ ] **Step 3 (red):** Fixture loader + 3 convert/mismatch tests (A1 fixtures). `swift test` → fail.
- [ ] **Step 4 (green):** Implement `BomExpandCompute.convertQty` + mismatch detection. Green.
- [ ] **Step 5:** `swift build` clean.
- [ ] **Step 6:** Commit `feat(native): A1 BomExpand types and convertQty parity`.

**Gate:** `--filter BomExpandComputeTests` green on A1 fixtures only.

---

## PR A2 — expand + aggregate + demand + warnings (~12–16 h)

**paths_touched:**

- `BomExpandCompute.swift` — add `expandRecipe`, `aggregateDemand`, `expandRecipeDemand`,
  `findManifestWarnings`, private recursion + sub-slug resolution + warnings sink
- `BomExpandComputeTests.swift` — remaining A2 fixtures (11 tests)

**MUST NOT touch:** `RecipeManifestLoader`, filesystem reads.

- [ ] **Step 1 (red):** `testSingleLeafScalesLinearly` from `single_leaf_scale.json` → fail.
- [ ] **Step 2 (green):** `expandRecipe` leaf-only path.
- [ ] **Step 3:** Sub-recipe rollup — `queso_embeds_salsa`, then headline `queso_plus_standalone_salsa`.
- [ ] **Step 4:** Errors — `cycle_a_b`, `unit_mismatch_sub_bag`.
- [ ] **Step 5:** `pack_size_bag_to_qt`, `graceful_skip_bad_sub` (warnings `inout`).
- [ ] **Step 6:** `explicit_sub_recipe_pin` (pin + token resolve).
- [ ] **Step 7:** `expandRecipeDemand` — half batch + compound salsa fixtures.
- [ ] **Step 8:** `findManifestWarnings` — orphan sub fixture.
- [ ] **Step 9:** Full `swift test --filter BomExpandComputeTests` green.
- [ ] **Step 10:** Opus parity review vs Python oracle.
- [ ] **Step 11:** Commit `feat(native): A2 BomExpand expand/aggregate/demand parity`.

**Gate:** All A2 fixtures green; Python `test_bom_expand.py` still green.

---

## PR A3 — RecipeManifestLoader (~8–10 h)

**paths_touched:**

- `LariatNative/Sources/LariatModel/Compute/RecipeManifestLoader.swift` (new)
- `BomExpandComputeTests.swift` or `RecipeManifestLoaderTests.swift` — loader + integration
- Optional: `BomExpandComputeTests/testPorkChopMarinade2x` uses loader + expand end-to-end

**MUST NOT touch:** `LariatApp`, spawn paths, cache mtime logic (stub only if needed).

- [ ] **Step 1 (red):** Load `recipes/recipe_index.csv` + `recipes/normalized/{slug}.csv`
  matching Python `build_manifest_from_normalized`.
- [ ] **Step 2 (green):** `pork_chop_marinade_2x` — load from repo `recipes/` in test via
  `LARIAT_ROOT` or test helper pointing at repo root.
- [ ] **Step 3 (red):** `canary_queso_green_chile_bag` — expand must throw `unitMismatch`
  (fixture uses synthetic manifest; loader test may use inline JSON).
- [ ] **Step 4:** Parse `pack_size` from index CSV (`bag:3:qt` format).
- [ ] **Step 5:** Parse `(sub-recipe=slug)` from BOM notes.
- [ ] **Step 6:** `swift test` full BomExpand + loader green.
- [ ] **Step 7:** Commit `feat(native): A3 RecipeManifestLoader + real-slug fixtures`.

**Gate:** Wave A complete per kickoff §10 — all `BomExpandComputeTests` green, Python oracle green.

---

## Wave A exit checklist

- [ ] 16 fixtures have matching Swift tests
- [ ] `swift build && swift test` green
- [ ] `python3 -m unittest tests.python.test_bom_expand -v` green
- [ ] Opus review recorded in handoff
- [ ] STATUS doc updated: Wave A → complete
- [ ] No files from kickoff §8.3 touched

**Next:** Wave B plan (`BeoPullCompute` + `BeoCascadeCompute`) — separate doc after A merges.
