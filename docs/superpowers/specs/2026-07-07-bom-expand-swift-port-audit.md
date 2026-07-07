---
title: "Scoped audit — bom_expand.py Swift port vs embedded Python"
date: 2026-07-07
status: draft — audit complete; implementation deferred to Phase III
parent: docs/superpowers/specs/2026-07-07-lariat-native-phase-iii-language-consolidation-backlog.md
generator: hand-authored (Cursor session audit)
---

# Scoped audit: `bom_expand.py` → Swift vs embedded Python

## Executive summary

| Option | Eng-hours (est.) | Risk | Fits Lariat endgame? |
|--------|------------------|------|----------------------|
| **A. Swift port** (`LariatModel`) | **48–72 h** | Medium — parity bugs if tests skipped | **Yes** |
| **B. Embedded Python** (bundle interpreter) | **24–40 h** | Medium — packaging/signing; logic unchanged | Partial |
| **C. Status quo** (spawn `python3`) | 0 | High for H8 — requires system Python | No for final `.pkg` |

**Recommendation:** **Option A** after Phase C cutover gates. The logic is bounded
(~920 LOC Python core + loader), heavily tested (30 unit tests), and the spawn
wrappers are already duplicated three ways (TS, Swift cascade, Swift calculator).

---

## 1. Source inventory

### Core Python (must move or embed)

| File | Lines | Role |
|------|------:|------|
| `scripts/lib/bom_expand.py` | **622** | Canonical recipe DAG walker |
| `scripts/lib/beo_pull.py` | **298** | BEO menu → demand → order guide |
| `scripts/bom_expand_cli.py` | 180 | JSON stdin/stdout for single-recipe expand |
| `scripts/beo_cascade_cli.py` | 298 | JSON stdin/stdout for BEO cascade (`build_cascade` ~120 LOC core) |
| **Subtotal** | **~1,398** | |

### `bom_expand.py` logic breakdown

| Section | Lines (approx.) | Port complexity |
|---------|----------------:|-----------------|
| Data model + exceptions | 25–68 | Low |
| Unit conversion (`convert_qty`, pack_size) | 70–143 | **Medium** — must match `UnitConvert.swift` subset; different tables today |
| `expand_recipe` / `_expand_into` | 153–389 | **High** — cycle detection, warnings sink, sub-recipe scaling |
| `expand_recipe_demand` / `_accumulate_*` | 193–300 | **High** — prep-board node aggregation |
| Sub-recipe name resolution (`_resolve_sub_slug`, pins) | 391–471 | **High** — token/subset matching, explicit `(sub-recipe=slug)` |
| CSV loaders (`build_manifest*`, `_load_recipe_index`) | 473–589 | Medium — 77 normalized CSVs today |
| `find_manifest_warnings` | 591–622 | Low |

**Effective port surface:** ~450 LOC algorithm + ~150 LOC CSV/manifest I/O (not
counting CLI JSON adapters, which become Swift public APIs).

### Spawn / wrapper layer (delete after in-process)

| File | Lines | Timeout |
|------|------:|---------|
| `lib/recipeCalculator.ts` | 181 | **5 s** (`DEFAULT_TIMEOUT_MS`) |
| `lib/beoCascade.ts` | 210 | **15 s** |
| `LariatNative/.../BeoCascadeClient.swift` | 384 | **15 s** |
| `LariatNative/.../AssistantSupport.swift` (`PythonBomCalculator`) | 172 | **5 s** |
| `LariatNative/.../RecipeCalculating.swift` | 81 | protocol only |

Native comments explicitly defer re-implementation: *"Python engine stays the
single source of truth"* (`BeoCascadeClient.swift:5-8`, A6.5 plan #369).

---

## 2. Spawn call sites (runtime)

### User-facing (service day)

| Caller | CLI | Trigger |
|--------|-----|---------|
| `app/api/kitchen-assistant/route.js` | `bom_expand_cli.py` | `scale_recipe`, `beo_add_prep`, `generate_prep` actions via `recipeCalculator.ts` |
| `app/api/beo/cascade/route.js` | `beo_cascade_cli.py` | BEO board cascade tab |
| `LariatNative` kitchen assistant | `bom_expand_cli.py` | Same actions via `PythonBomCalculator` |
| `LariatNative` BEO board | `beo_cascade_cli.py` | `BeoCascadeRepository` → `BeoCascadeClient` |

### Offline / CLI (keep Python longer)

| Caller | Module | Notes |
|--------|--------|-------|
| `scripts/beo_order_pull.py` | `beo_pull` + `bom_expand` | Batch order pull; not spawned from Node |
| `scripts/beo_cascade_cli.py` `build_cascade` | imported in tests | Pure function — good Swift port seam |

**Not spawned:** `ingest-costing.mjs` does **not** import `bom_expand` (T6/pack-size
and rollup are in-process TypeScript).

### Environment contract (all spawns)

| Variable | Purpose |
|----------|---------|
| `LARIAT_PYTHON` | Python binary (default `python3`) |
| `LARIAT_ROOT` | Repo root containing `recipes/` + `scripts/` |
| `cwd` fallback | Native walks up to find `scripts/beo_cascade_cli.py` |

Desktop wrapper doc (`docs/desktop-wrapper-design.md`) states wrapper **does not
bundle Python** — wizard exposes `pythonPath`. This blocks H8 "double-click works"
for BEO/assistant without system Python.

---

## 3. Data dependencies per call

Each spawn rebuilds manifest from disk:

```
recipes/recipe_index.csv          (~78 rows today)
recipes/normalized/<slug>.csv     (77 files today)
menus/beo_recipe_map.csv          (cascade only)
```

**Performance note:** Python unit tests run 30 cases in **~7 ms** — compute is
cheap; **cold spawn + CSV I/O** dominates. Measured improvement from in-process
is expected on the order of **100–500 ms per call** (interpreter startup), not
algorithmic Big-O gains.

**Swift port should cache manifest** in memory (invalidate on recipe dir mtime)
— legitimate win beyond parity.

---

## 4. Test oracle (parity contract)

### Primary — Python unit (30 tests, 572 lines)

`tests/python/test_bom_expand.py` — run: `python3 -m unittest tests.python.test_bom_expand`

| Class | What it guards |
|-------|----------------|
| `ExpandLeafOnly` | Linear scaling |
| `ExpandWithSubRecipe` | **Headline:** queso + standalone salsa **sums** leaves |
| `Errors` | Unknown slug, cycle, unit mismatch |
| `ExpandRecipeDemand` | Prep-board per-recipe nodes |
| `ManifestFromCsvs` | Real CSV canary (queso/green_chile bag mismatch) |
| `UnitConversion` | cup↔qt, gal↔qt; lb vs qt fails |
| `GracefulDegradation` | `warnings` sink skips bad row, keeps siblings |
| `PackSizeConversion` | `bag:3:qt` cross-dimension |
| `ExplicitSubRecipePin` | `(sub-recipe=slug)` in notes |
| `ManifestWarnings` | Orphan declared sub-recipes |

One test skipped when costing CSVs absent; CI with full repo runs canary.

### BEO pull + cascade (583 lines Python)

- `tests/python/test_beo_pull.py` (230 lines)
- `tests/python/test_beo_cascade_cli.py` (353 lines) — includes subprocess integration

### JavaScript integration (real recipes on disk)

- `tests/js/test-recipe-calculator.mjs` — **5 tests**, spawns CLI for `pork_chop_marinade`
- `tests/js/test-beo-cascade.mjs` — wrapper contract

### Native (wrapper only today)

- `LariatNative/Tests/LariatModelTests/BeoCascadeClientTests.swift` — payload/parse/root resolve; **no math oracle**
- `LariatNative/Tests/LariatDBTests/BeoCascadeRepositoryTests.swift` — DB + stubbed CLI output

**Gap:** No native tests assert queso+salsa aggregation math — port must add
`BomExpandComputeTests.swift` mirroring Python classes above.

---

## 5. Public API to preserve

### Single-recipe expand (kitchen assistant)

Web contract (`lib/recipeCalculator.ts`):

```typescript
scaleRecipe(slug, multiplier) → ExpandResult
expandForBEO([{slug, portionsPerGuest}], guestCount) → ExpandResult[]
formatLeafRowsAsTasks(leafRows) → string[]  // already pure Swift
```

CLI JSON (`bom_expand_cli.py`) — oracle for wire shape.

Swift already has `RecipeCalculating` protocol — implementation swaps from
`PythonBomCalculator` to `NativeBomCalculator`.

### BEO cascade

Web contract (`lib/beoCascade.ts`):

```typescript
cascadeFromLineItems(lineItems, { qtyInYieldUnits, inventory }) → CascadeResult
```

CLI adds `warnings`, `manifest_warnings` — native parser already handles these
(`BeoCascadeClient.parseCascadeResponse`).

---

## 6. Option A — Swift port (recommended)

### Scope

| Deliverable | Location |
|-------------|----------|
| `BomExpandCompute` | `LariatModel/Compute/` — expand, aggregate, expandRecipeDemand, convert_qty, sub-slug resolution |
| `BeoPullCompute` | `LariatModel/Compute/` — load map, build_demand, pull_orders |
| `BeoCascadeCompute` | compose pull + expand (port `build_cascade`) |
| `RecipeManifestLoader` | read `recipe_index.csv` + normalized CSVs; cache |
| `NativeBomCalculator` | `LariatModel` — replaces spawn in assistant |
| Update `BeoCascadeClient` | call in-process engine; keep `Runner` injectable for tests |

### Out of scope (Phase III-1)

- Rewriting `scripts/beo_order_pull.py` CLI
- Changing recipe file formats
- Web route deletion (Phase D — after native parity proven)

### Task breakdown + hours

| Task | Hours | Notes |
|------|------:|-------|
| Spec + golden vectors from Python tests | 4–6 | Export fixtures JSON from pytest |
| `BomExpandCompute` core + tests | 16–24 | Hardest: warnings sink, pack_size, pins |
| `RecipeManifestLoader` + cache | 6–8 | 77 CSVs; watch mtime |
| `BeoPullCompute` + tests | 8–12 | Port `test_beo_pull.py` |
| `BeoCascadeCompute` + tests | 6–8 | Port `build_cascade` |
| Wire native assistant + BEO repo | 4–6 | Delete `PythonBomCalculator` spawn |
| Web optional: call native via edge OR keep spawn until Phase D | 0–8 | Policy choice |
| Manifest cache perf + manual BEO smoke | 4–6 | |
| **Total** | **48–72** | 1.5–2 weeks focused |

### Risks

- **Unit table drift** vs `UnitConvert.swift` — reconcile explicitly (shared constants file or generated fixtures).
- **Float tolerance** — Python and Swift both use IEEE double; golden tests should use `places=6` like Python.
- **Real-data canary** — queso/green_chile bag test must stay failing until data fixed OR pack_size declared (do not weaken).

---

## 7. Option B — Embedded Python

### Approach

Bundle CPython + `scripts/` + `recipes/` inside `.app` Resources; call
`PyImport` / PythonKit from Swift instead of `Process`.

### Pros

- **24–40 h** if packaging pipeline cooperates
- Zero algorithm port; Python tests remain oracle unchanged
- `beo_order_pull.py` continues to share library

### Cons

- **+50–100 MB** app size; notarization + hardened runtime for embedded interpreter
- Still ship recipe CSV tree; still need `LARIAT_ROOT` semantics
- **Two runtimes** (Swift + Python) forever — conflicts with Phase D/E consolidation
- PythonKit maintenance / Swift 6 concurrency friction
- Does not help web edge until Node also embeds Python (Electron non-goal)

### When to choose B

- Swift port blocked mid-flight (infra deadline)
- Temporary bridge **only** with written deprecation date and same spawn API surface

---

## 8. Option C — Status quo

Acceptable for **web hub + dev** until H8. Unacceptable for **notarized native-only**
service day per `LARIAT_NATIVE_FINAL_AGENT_GUIDE.md` H8 gates.

---

## 9. Decision matrix

```
                    Packaging   Parity risk   Long-term fit   Effort
Swift port (A)        ★★★★★       ★★★☆☆         ★★★★★          48–72h
Embedded Python (B)   ★★★☆☆       ★★★★★         ★★☆☆☆          24–40h
Status quo (C)        ★☆☆☆☆       ★★★★★         ★☆☆☆☆            0h
Rust/Tauri/PyO3       ★★☆☆☆       ★★☆☆☆         ★☆☆☆☆         120h+
```

---

## 10. Suggested implementation sequence (when Phase III opens)

1. **Fixtures first** — export 15–20 golden `(manifest, demand) → leaves/nodes` vectors from Python tests to JSON under `LariatNative/Tests/Fixtures/BomExpand/`.
2. **`BomExpandCompute`** — TDD until Python suite parity green in Swift.
3. **`BeoPullCompute` + `BeoCascadeCompute`** — cascade integration tests.
4. **Native wire-up** — `NativeBomCalculator`, in-process `BeoCascadeClient`.
5. **Manifest cache** — measure BEO tab load before/after.
6. **Web** — either keep spawn until Phase D or add shared test vectors only.
7. **Delete** spawn code paths in native; document Python CLIs as offline tools.

### Model tier routing (implementation)

| Step | Tier |
|------|------|
| This audit / spec | Sonnet |
| Swift port implementation | Sonnet + TDD |
| Parity review before merge | Opus |
| C5-style "delete web spawn" decision | Opus/Max |

---

## 11. References

- `scripts/lib/bom_expand.py` — module docstring (contract)
- `docs/superpowers/plans/2026-06-18-beo-event-ops.md` — D3/D4 cascade design
- `docs/superpowers/plans/2026-07-02-lariat-native-a6-5-beo-internal.md` — #369 watch
- `docs/desktop-wrapper-design.md` — Python not bundled in Electron v1
- `docs/superpowers/specs/2026-07-06-lariat-native-h6b-native-printing-design.md` — cascade spawn ≤15s cited
