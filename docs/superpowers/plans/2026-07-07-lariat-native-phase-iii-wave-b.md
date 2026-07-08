# L1 Wave B — BeoPull + BeoCascadeCompute (Native 0.2)

> **Terminology:** [`docs/NATIVE_RELEASES_AND_TAXONOMY.md`](../../NATIVE_RELEASES_AND_TAXONOMY.md) — **L1 Wave B**, not Milestone B.
> **Prerequisite:** L1 Wave A merged (BomExpandCompute + RecipeManifestLoader).
> Read STATUS + `specs/2026-07-07-beo-fixture-manifest.md`.

**Goal:** Port `scripts/lib/beo_pull.py` + `build_cascade` to Swift pure compute.
**No App wiring, no spawn deletion.**

**Branch:** `feat/lariat-native-phase-iii-bom-inprocess` (or follow-on `feat/...-wave-b`)

---

## PR slices

| PR | Scope | Hours |
|----|--------|-------|
| **B1** | `BeoPullCompute` — normalize, buildDemand, loadBeoRecipeMap | 8–10 |
| **B2** | `BeoCascadeCompute.buildCascade` + JSON-shaped result | 8–10 |

---

## B1 — BeoPullCompute

**paths:**

- `LariatModel/Compute/BeoPullTypes.swift`
- `LariatModel/Compute/BeoPullCompute.swift`
- `Tests/LariatModelTests/BeoPullComputeTests.swift`
- Reuse `BomExpandFixtureLoader` pattern for `BeoCascade/` fixtures

**fixtures (10):** all `build_demand_*`, `pull_orders_*`, `normalize_client_*`

**Gate:** `swift test --filter BeoPullComputeTests` + Python `test_beo_pull.py` green.

---

## B2 — BeoCascadeCompute

**paths:**

- `LariatModel/Compute/BeoCascadeCompute.swift`
- `Tests/LariatModelTests/BeoCascadeComputeTests.swift`

**fixtures (5):** all `cascade_*` JSON files

**Additional Swift-only tests (no fixture):**

- `testManifestWarningsScopedToReachableRecipes` — from Python `test_manifest_warnings_scoped_to_event_recipes`
- `testPrepDemandsSortedByDisplayName` — from Python `test_prep_demands_sorted_by_display_name`
- `testMapWarningsMergedIntoUnmapped` — from Python `test_map_warnings_surfaced_in_unmapped`

**Gate:** `swift test --filter BeoCascadeComputeTests` + Python `test_beo_cascade_cli.py` unit tests green.

**Opus review** before L1 Wave C merge.

---

## Dependencies on Wave A

| Wave A symbol | Used by |
|---------------|---------|
| `BomExpandCompute.aggregateDemand` | `pull_orders` |
| `BomExpandCompute.expandRecipeDemand` | `build_cascade` prep_demands |
| `RecipeManifestLoader` | optional in B1 integration test with real `menus/beo_recipe_map.csv` |

---

## MUST NOT modify

- `BeoCascadeClient.swift` default runner (L1 Wave C)
- `AssistantSupport.swift` (L1 Wave C)
- Web routes / TS spawn paths
