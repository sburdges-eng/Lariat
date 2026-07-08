# Cost Confidence & Gap Triage — Design (Spec B)

**Date:** 2026-07-07
**Status:** Draft for review
**Author:** Claude (Opus 4.8) with owner
**Scope:** Surface per-recipe/per-line cost trustworthiness in native + web, plus a
read-time plausibility guardrail. Data-only fixes (density values, gap closure) are
documented as the follow-on data-ops worklist this layer produces — **not** code here.

---

## 1. Problem & honest baseline

The owner observed, GUI-smoking the native costing boards, that costing "particularly
by pack size or unit size was largely inaccurate." Investigation established two things:

1. **Native == web is proven, not in question.** `UnitConvert` + `CostVarianceCompute`
   + `DishCostBridge` pass the byte-parity suite against the web golden fixtures
   (60 `LariatModelTests`, 0 failures, on `main` @ `5fcfde5`). The native port adds no
   error. The inaccuracy is entirely in the underlying data.

2. **Every recipe gets a number, but most numbers embed estimates — and nothing shows
   which.** The pipeline's own per-line verdict (`bom_lines.map_status`, computed at
   ingest with the real `ingredient_densities`/`ingredient_unit_weights`/`ingredient_yields`
   lookups) and the per-recipe rollup (`recipe_costs.{costed_lines,total_lines,interpretations}`)
   already encode trustworthiness. It is simply never surfaced.

Live-DB baseline (302 `bom_lines`, 42 recipes, location `default`):

| Line status (`map_status`)        | Count | %   |
|-----------------------------------|-------|-----|
| `mapped` (clean)                  | 234   | 77% |
| `cost_proxy_*` (approximation)    | 17    | 6%  |
| `plan_*` (planning placeholder)   | 29    | 10% |
| `NEEDS_DENSITY` (can't convert)   | 9     | 3%  |
| `UNMAPPED` (no vendor)            | 13    | 4%  |

| Recipe confidence (`recipe_costs`)                          | Count | %   |
|-------------------------------------------------------------|-------|-----|
| 🟢 Clean — `interpretations = 0`, `costed = total`          | 7     | 17% |
| 🟡 Estimated — fully costed, `interpretations > 0`          | 35    | 83% |
| 🔴 Incomplete — `costed_lines < total_lines`                | 0     | 0%  |

So only **17% of recipe costs are fully clean**; **83% carry ≥1 interpreted line** with
no operator-visible signal — which is exactly why every cost "looks equally (un)trustworthy."
Example: `aji_verde` = `$27.56/batch`, `$15.66/qt`, 8/8 lines costed, **4 interpretations**.

**Correction of record:** an earlier ad-hoc script that passed `density=null` reported
"63% of lines dropped / 25% bogus." That was a measurement artifact (it ignored the
118-row density table and the `cost_proxy` mechanism). The authoritative figures are the
table above, read from `map_status` / `recipe_costs`.

## 2. Goal & non-goals

**Goal:** make cost trustworthiness visible and actionable, so (a) operators know which
recipe costs to trust, and (b) the invisible value/gap problems become a concrete,
ranked worklist.

**Non-goals (this spec):**
- Fixing density values or filling gaps (that is data-ops — see §8).
- Any schema change, ingest change, or persisted flag (guardrail is read-time — §6).
- Changing any costing math. Parity with web is preserved; native mirrors web.

## 3. Confidence model — `CostConfidenceCompute` (pure `LariatModel/Compute`)

A new pure compute (no I/O), the parity-critical core, unit-tested first.

**Per-recipe tier** from `recipe_costs`:
- 🟢 **Clean** — `interpretations == 0 && costed_lines == total_lines`
- 🟡 **Estimated** — `costed_lines == total_lines && interpretations > 0`
- 🔴 **Incomplete** — `costed_lines < total_lines` (understated; 0 today, modeled for safety)
- **Unknown** — any of the three fields NULL (older ingest) → sorts after Clean, before Estimated;
  labeled "not yet analyzed" (no false green).

**Per-line label** from `bom_lines.map_status`:
- `mapped` → **mapped**
- `cost_proxy_*` → **proxy**
- `plan_*` → **placeholder**
- `NEEDS_DENSITY` → **needs density**
- `UNMAPPED` → **unmapped**
- anything else → **other** (forward-compatible)

**Ranking** (worst-first worklist): 🔴 before 🟡 before Unknown before 🟢; within a tier,
by descending interpreted/uncosted line count, then recipe name ascending (deterministic).

**Operator copy** (no jargon): recipe row reads e.g. `Estimated · 4 of 8 lines estimated`;
`interpretations` is never shown as a raw word.

## 4. Data layer

- **Native** `CostingRepository`: extend the existing `recipe_costs` SELECT (currently
  `recipe_id, recipe_name, cost_per_yield_unit, yield, yield_unit, batch_cost`) to also
  read `costed_lines, total_lines, interpretations`. Add a read for per-recipe
  `bom_lines.{ingredient, unit, map_status, pack_price, pack_size, yield_pct, loss_factor}`
  and the density/unit-weight rows the guardrail needs (§6). New `Records` structs as needed.
- **Web** `/costing`: the query already reads `recipe_costs`; add the same three columns and
  the per-line `map_status` for the drill-down.
- No schema change — all columns already exist and are populated by the ingest.

## 5. Surfaces

### 5a. Native — dedicated "Cost Confidence" board (`.costing` tier)
- New `FeatureCatalog`/`FeatureRegistry` entry `costing.confidence` ("Cost Confidence"),
  registered via the standard A0 4-edit pattern. Unregulated read (no PIN) — matches the
  rest of the `.costing` read boards.
- Board body: recipes ranked worst-first; each row shows tier dot, recipe name,
  `batch_cost`, `cost_per_yield_unit`, and "N of M lines estimated". Expanding a recipe
  lists its lines with the per-line label and any guardrail flag/reason (§6).
- A summary header: "7 clean · 35 estimated · 0 incomplete" (live counts).
- Additive: the tier dot appears on recipe rows in the existing `MenuEngineeringView` /
  `CostingView` recipe lists (small, additive, no layout restructuring).

### 5b. Web — `/costing`
- Matching per-recipe badge + the same ranked list/section, reading the same fields so the
  two stay in parity. Same operator copy.

## 6. Read-time plausibility guardrail (in `CostConfidenceCompute`)

Applied live to the data the recipe already carries — **no persistence, no ingest change.**
Each rule is a named, tunable constant; a triggered rule attaches a `flag + reason` to the line:

- **Density out of band** — ingredient's `g_per_ml ∉ [0.2, 2.0]` (water = 1.0; most foods
  0.3–1.5). Reason: `check density: <value> g/ml`.
- **Unit-weight outlier** — a count unit's `g_per_unit` outside a sane band
  (e.g. `< 1 g` or `> 5000 g` per each/bunch/case). Reason: `check unit weight: <value> g`.
- **Dominant line** — a single bom line contributes `> 60%` of the recipe `batch_cost`.
  Reason: `one line is <pct>% of batch cost — verify`.

A recipe with any flagged line is badged "⚠ verify" in the board regardless of tier, and the
line's reason shows in the drill-down. Constants live in the compute so thresholds can be
tuned without touching call sites. Rules are identical in native and web (parity).

## 7. Testing (TDD)

- `CostConfidenceComputeTests` (native, written first, the parity-critical core):
  tier boundaries (`interpretations` 0 vs >0; `costed < total`; NULL fields → Unknown),
  per-line label mapping (each `map_status` family + unknown), ranking determinism, and
  each guardrail rule (in-band vs out-of-band density, unit-weight outlier, dominant-line
  at 59% vs 61%). Mirror the same cases in a web `test-cost-confidence.mjs` so both stay
  in parity.
- `CostingRepository` read test: the three new columns + per-line rows load correctly.
- View + `/costing` wiring: build-verified (`LariatApp` has no unit-test target, as always;
  stated honestly in commits/PR).

## 8. Follow-on data-ops (out of code scope — the worklist this board produces)

- **A. Density-value accuracy** — improve `ingredient_densities.g_per_ml` /
  `ingredient_unit_weights.g_per_unit` where the guardrail or operator flags them. Needs
  real reference densities (chef/USDA). Never "done"; driven by the board's ⚠ flags.
- **C. Gap closure** — work down the bounded list the board surfaces: 9 `NEEDS_DENSITY`
  (supply density), 13 `UNMAPPED` (map a vendor), 29 `plan_*` placeholders + 17
  `cost_proxy_*` (replace with real mappings where a real one exists).
- Both are data entry against `ingredient_densities` / `ingredient_unit_weights` /
  `vendor_prices` and the recipe workbook, then re-run the costing ingest. No code.

## 9. Risks & open items

- **Threshold tuning:** the guardrail bands are heuristics; first values are conservative
  (catch order-of-magnitude typos, not fine errors). Tunable constants; revisit after the
  board shows real flag volume.
- **`interpretations` semantics:** treated as "count of lines that required interpretation"
  (per the ingest's upstream counter). The tier model only depends on `>0` vs `==0`, so it
  is robust to the exact increment rule; the drill-down uses `map_status` directly, not the
  count, for per-line truth.
- **Parity discipline:** every rule/threshold must be identical in the native compute and
  the web test/display; the web `test-cost-confidence.mjs` is the shared oracle.
- **No persistence:** operators cannot "mark a line reviewed" in this MVP. If wanted, that
  is a clean follow-on (adds a review table/column — a schema change deferred deliberately).
