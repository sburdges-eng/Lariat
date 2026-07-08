# Cost Confidence & Gap Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-recipe/per-line cost trustworthiness (native + web) from data the ingest already stores, plus a read-time density/cost plausibility guardrail — so operators can tell solid costs from estimated ones.

**Architecture:** A new pure `LariatModel/CostConfidenceCompute` derives recipe tiers + per-line labels + guardrail flags from value inputs (no I/O). `LariatDB/CostingRepository` gains a read that packs `recipe_costs` (incl. the 3 confidence columns) + per-recipe `bom_lines.map_status` + density/unit-weight rows into those inputs. A new native "Cost Confidence" board renders the ranked result; the web `/costing` page mirrors it via a parity oracle. No schema or ingest change.

**Tech Stack:** Swift 5.9 / SwiftPM (LariatModel pure, LariatDB = GRDB, LariatApp = SwiftUI, macOS-only); web = Next.js + `better-sqlite3`, tests via `node --experimental-strip-types --test`.

## Global Constraints

- **No schema change, no ingest change.** All columns (`recipe_costs.costed_lines/total_lines/interpretations`, `bom_lines.map_status`, `ingredient_densities.g_per_ml`, `ingredient_unit_weights.g_per_unit`) already exist and are populated by the ingest. (spec §2, §4, §6)
- **No costing-math change.** Do not alter `UnitConvert`, `CostVarianceCompute`, `CostingCompute`, or `DishCostBridge`. (spec §2)
- **Guardrail constants (exact, tunable):** density `g_per_ml` valid band `[0.2, 2.0]`; unit-weight `g_per_unit` valid band `[1.0, 5000.0]`; dominant-line share `> 0.60` of `batch_cost`. (spec §6)
- **Parity discipline:** every tier rule, label mapping, and guardrail threshold must be byte-identical in the native compute and the web `test-cost-confidence.mjs` oracle. (spec §7, §9)
- **Operator copy — no jargon:** never render the raw word "interpretations". A recipe row reads e.g. `Estimated · 4 of 8 lines estimated`. (spec §3)
- **Test homes:** parity-critical logic → `LariatModel` (XCTest, `Tests/LariatModelTests/`); repository reads → `LariatDB` (XCTest, `Tests/LariatDBTests/`); `LariatApp` (executable) has **no** unit-test target — view/board wiring is `swift build`-verified and stated honestly in commits. (spec §7)
- **Native gate:** `swift build && swift test` from `LariatNative/`. **Web gate:** `node --experimental-strip-types --test tests/js/test-cost-confidence.mjs` + `npm run typecheck`.

---

## File Structure

**Create:**
- `LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift` — pure tier/label/guardrail logic + output types.
- `LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift` — parity-critical unit tests.
- `LariatNative/Sources/LariatModel/CostConfidenceRecords.swift` — repo-facing input structs (value types, no GRDB).
- `LariatNative/Sources/LariatApp/CostConfidenceView.swift` — the board (view + `@Observable` VM).
- `LariatNative/Tests/LariatDBTests/CostConfidenceRepositoryTests.swift` — repo read test.
- `lib/costConfidence.mjs` — web port of the compute (pure, mirrors the Swift).
- `tests/js/test-cost-confidence.mjs` — web parity oracle.

**Modify:**
- `LariatNative/Sources/LariatDB/CostingRepository.swift` — add `fetchCostConfidence(db:locationId:)`.
- `LariatNative/Sources/LariatModel/FeatureCatalog.swift:108` — add the `costing.confidence` descriptor.
- `LariatNative/Sources/LariatApp/CostingFeatures.swift` — add the `costingConfidence` module.
- `LariatNative/Sources/LariatApp/FeatureRegistry.swift:66` — list `.costingConfidence`.
- `LariatNative/Sources/LariatApp/MenuEngineeringView.swift` — additive tier dot on recipe rows.
- `app/costing/page.jsx` (or the costing dashboard entry) — render the confidence badge + ranked section.

---

## Task 1: CostConfidenceCompute — recipe tiers + summary

**Files:**
- Create: `LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift`
- Create: `LariatNative/Sources/LariatModel/CostConfidenceRecords.swift`
- Test: `LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift`

**Interfaces:**
- Produces: `CostConfidenceTier` (enum: `.incomplete`/`.estimated`/`.unknown`/`.clean`, `Comparable` worst-first), `CostConfidenceRecipeInput` (value struct), and `CostConfidenceCompute.tier(costedLines:totalLines:interpretations:) -> CostConfidenceTier`. Later tasks consume these exact names.

- [ ] **Step 1: Write the failing test**

Create `LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift`:

```swift
import XCTest
@testable import LariatModel

// Parity tests for CostConfidenceCompute — trust tiers from recipe_costs fields.
// Tier rules (spec §3):
//   clean      = interpretations == 0 && costed_lines == total_lines
//   estimated  = costed_lines == total_lines && interpretations > 0
//   incomplete = costed_lines < total_lines
//   unknown    = any of the three fields nil
final class CostConfidenceComputeTests: XCTestCase {

    func testTierClean() {
        XCTAssertEqual(CostConfidenceCompute.tier(costedLines: 8, totalLines: 8, interpretations: 0), .clean)
    }

    func testTierEstimatedWhenInterpretationsPositive() {
        XCTAssertEqual(CostConfidenceCompute.tier(costedLines: 8, totalLines: 8, interpretations: 4), .estimated)
    }

    func testTierIncompleteWhenCostedBelowTotal() {
        XCTAssertEqual(CostConfidenceCompute.tier(costedLines: 6, totalLines: 8, interpretations: 0), .incomplete)
    }

    func testTierUnknownWhenAnyFieldNil() {
        XCTAssertEqual(CostConfidenceCompute.tier(costedLines: nil, totalLines: 8, interpretations: 0), .unknown)
        XCTAssertEqual(CostConfidenceCompute.tier(costedLines: 8, totalLines: nil, interpretations: 0), .unknown)
        XCTAssertEqual(CostConfidenceCompute.tier(costedLines: 8, totalLines: 8, interpretations: nil), .unknown)
    }

    func testTierOrderingWorstFirst() {
        XCTAssertTrue(CostConfidenceTier.incomplete < .estimated)
        XCTAssertTrue(CostConfidenceTier.estimated < .unknown)
        XCTAssertTrue(CostConfidenceTier.unknown < .clean)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LariatNative && swift test --filter CostConfidenceComputeTests`
Expected: FAIL — "cannot find 'CostConfidenceCompute' in scope".

- [ ] **Step 3: Write minimal implementation**

Create `LariatNative/Sources/LariatModel/CostConfidenceRecords.swift`:

```swift
import Foundation

/// Repo-supplied per-recipe input (subset of recipe_costs).
public struct CostConfidenceRecipeInput: Equatable, Sendable {
    public let recipeId: String
    public let recipeName: String?
    public let batchCost: Double?
    public let costPerYieldUnit: Double?
    public let yieldUnit: String?
    public let costedLines: Int?
    public let totalLines: Int?
    public let interpretations: Int?

    public init(recipeId: String, recipeName: String?, batchCost: Double?, costPerYieldUnit: Double?,
                yieldUnit: String?, costedLines: Int?, totalLines: Int?, interpretations: Int?) {
        self.recipeId = recipeId; self.recipeName = recipeName; self.batchCost = batchCost
        self.costPerYieldUnit = costPerYieldUnit; self.yieldUnit = yieldUnit
        self.costedLines = costedLines; self.totalLines = totalLines; self.interpretations = interpretations
    }
}
```

Create `LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift`:

```swift
import Foundation

// GRDB-free cost-trust computation. Surfaces trustworthiness the ingest already
// records (recipe_costs.{costed_lines,total_lines,interpretations} + bom_lines.map_status)
// plus a read-time plausibility guardrail. No I/O; no costing math is re-derived.
// Mirror of lib/costConfidence.mjs (parity oracle: tests/js/test-cost-confidence.mjs).

/// Per-recipe trust tier. `Comparable` sorts WORST-first for the triage worklist.
public enum CostConfidenceTier: String, Equatable, Sendable, Comparable {
    case incomplete   // costed_lines < total_lines (understated)
    case estimated    // fully costed, interpretations > 0
    case unknown      // any confidence field nil (older ingest)
    case clean        // interpretations == 0, costed == total

    private var rank: Int {
        switch self {
        case .incomplete: return 0
        case .estimated:  return 1
        case .unknown:    return 2
        case .clean:      return 3
        }
    }
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rank < rhs.rank }
}

public enum CostConfidenceCompute {
    public static func tier(costedLines: Int?, totalLines: Int?, interpretations: Int?) -> CostConfidenceTier {
        guard let costed = costedLines, let total = totalLines, let interp = interpretations else {
            return .unknown
        }
        if costed < total { return .incomplete }
        return interp > 0 ? .estimated : .clean
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LariatNative && swift test --filter CostConfidenceComputeTests`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/CostConfidenceRecords.swift \
        LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift \
        LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift
AGENT_NAME=claude git commit -m "T1: CostConfidenceCompute recipe tiers (cost confidence)"
```

---

## Task 2: Per-line labels + plausibility guardrail

**Files:**
- Modify: `LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift`
- Modify: `LariatNative/Sources/LariatModel/CostConfidenceRecords.swift`
- Test: `LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift`

**Interfaces:**
- Consumes: `CostConfidenceTier` (Task 1).
- Produces: `CostLineLabel` enum; `CostLineInput` struct (repo-supplied, incl. `lineBatchShare: Double?` — the line's `$ / batch_cost`, computed in the repo, Task 3); `CostConfidenceCompute.label(mapStatus:) -> CostLineLabel` and `CostConfidenceCompute.lineFlags(_:) -> [String]`. Guardrail constants exposed as `static let` for tuning.

- [ ] **Step 1: Write the failing test**

Append to `CostConfidenceComputeTests.swift`:

```swift
extension CostConfidenceComputeTests {

    func testLineLabelMapping() {
        XCTAssertEqual(CostConfidenceCompute.label(mapStatus: "mapped"), .mapped)
        XCTAssertEqual(CostConfidenceCompute.label(mapStatus: "cost_proxy_white_pepper"), .proxy)
        XCTAssertEqual(CostConfidenceCompute.label(mapStatus: "plan_supplement"), .placeholder)
        XCTAssertEqual(CostConfidenceCompute.label(mapStatus: "NEEDS_DENSITY"), .needsDensity)
        XCTAssertEqual(CostConfidenceCompute.label(mapStatus: "UNMAPPED"), .unmapped)
        XCTAssertEqual(CostConfidenceCompute.label(mapStatus: "SOMETHING_NEW"), .other)
        XCTAssertEqual(CostConfidenceCompute.label(mapStatus: nil), .other)
    }

    private func line(_ status: String?, gPerMl: Double? = nil, gPerUnit: Double? = nil, share: Double? = nil) -> CostLineInput {
        CostLineInput(recipeId: "r", ingredient: "x", mapStatus: status, gPerMl: gPerMl, gPerUnit: gPerUnit, lineBatchShare: share)
    }

    func testDensityGuardrailBand() {
        XCTAssertTrue(CostConfidenceCompute.lineFlags(line("mapped", gPerMl: 1.0)).isEmpty)          // in band
        XCTAssertTrue(CostConfidenceCompute.lineFlags(line("mapped", gPerMl: 0.2)).isEmpty)          // lower edge ok
        XCTAssertTrue(CostConfidenceCompute.lineFlags(line("mapped", gPerMl: 2.0)).isEmpty)          // upper edge ok
        XCTAssertEqual(CostConfidenceCompute.lineFlags(line("mapped", gPerMl: 8.4)).count, 1)        // out of band
        XCTAssertEqual(CostConfidenceCompute.lineFlags(line("mapped", gPerMl: 0.05)).count, 1)
    }

    func testUnitWeightGuardrailBand() {
        XCTAssertTrue(CostConfidenceCompute.lineFlags(line("mapped", gPerUnit: 200.0)).isEmpty)
        XCTAssertEqual(CostConfidenceCompute.lineFlags(line("mapped", gPerUnit: 0.0)).count, 1)
        XCTAssertEqual(CostConfidenceCompute.lineFlags(line("mapped", gPerUnit: 9000.0)).count, 1)
    }

    func testDominantLineGuardrail() {
        XCTAssertTrue(CostConfidenceCompute.lineFlags(line("mapped", share: 0.59)).isEmpty)
        XCTAssertEqual(CostConfidenceCompute.lineFlags(line("mapped", share: 0.61)).count, 1)
        XCTAssertTrue(CostConfidenceCompute.lineFlags(line("mapped", share: 0.60)).isEmpty)  // strictly > 0.60
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LariatNative && swift test --filter CostConfidenceComputeTests`
Expected: FAIL — "cannot find 'CostLineInput'" / "type 'CostConfidenceCompute' has no member 'label'".

- [ ] **Step 3: Write minimal implementation**

Append to `CostConfidenceRecords.swift`:

```swift
/// Repo-supplied per-line input. `lineBatchShare` is this line's $ divided by the
/// recipe batch_cost (0…1), computed in the repository from the same per-line pricing
/// CostVarianceCompute uses; nil when it cannot be priced.
public struct CostLineInput: Equatable, Sendable {
    public let recipeId: String
    public let ingredient: String?
    public let mapStatus: String?
    public let gPerMl: Double?
    public let gPerUnit: Double?
    public let lineBatchShare: Double?

    public init(recipeId: String, ingredient: String?, mapStatus: String?,
                gPerMl: Double?, gPerUnit: Double?, lineBatchShare: Double?) {
        self.recipeId = recipeId; self.ingredient = ingredient; self.mapStatus = mapStatus
        self.gPerMl = gPerMl; self.gPerUnit = gPerUnit; self.lineBatchShare = lineBatchShare
    }
}
```

Append to `CostConfidenceCompute.swift`:

```swift
/// Plain per-line label from bom_lines.map_status (spec §3).
public enum CostLineLabel: String, Equatable, Sendable {
    case mapped, proxy, placeholder, needsDensity, unmapped, other
}

public extension CostConfidenceCompute {
    // Tunable guardrail constants (spec §6).
    static let densityMinGPerMl = 0.2
    static let densityMaxGPerMl = 2.0
    static let unitWeightMinG = 1.0
    static let unitWeightMaxG = 5000.0
    static let dominantLineShare = 0.60

    static func label(mapStatus: String?) -> CostLineLabel {
        guard let s = mapStatus else { return .other }
        if s == "mapped" { return .mapped }
        if s == "UNMAPPED" { return .unmapped }
        if s == "NEEDS_DENSITY" { return .needsDensity }
        if s.hasPrefix("cost_proxy") { return .proxy }
        if s.hasPrefix("plan") { return .placeholder }
        return .other
    }

    /// Read-time plausibility flags with operator-facing reasons; empty when the line looks fine.
    static func lineFlags(_ line: CostLineInput) -> [String] {
        var flags: [String] = []
        if let d = line.gPerMl, d < densityMinGPerMl || d > densityMaxGPerMl {
            flags.append("check density: \(trim(d)) g/ml")
        }
        if let w = line.gPerUnit, w < unitWeightMinG || w > unitWeightMaxG {
            flags.append("check unit weight: \(trim(w)) g")
        }
        if let share = line.lineBatchShare, share > dominantLineShare {
            flags.append("one line is \(Int((share * 100).rounded()))% of batch cost — verify")
        }
        return flags
    }

    private static func trim(_ x: Double) -> String {
        x == x.rounded() ? String(Int(x)) : String(x)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LariatNative && swift test --filter CostConfidenceComputeTests`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/CostConfidenceRecords.swift \
        LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift \
        LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift
AGENT_NAME=claude git commit -m "T2: per-line labels + plausibility guardrail (cost confidence)"
```

---

## Task 3: summarize() — assemble ranked recipes + summary

**Files:**
- Modify: `LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift`
- Modify: `LariatNative/Sources/LariatModel/CostConfidenceRecords.swift`
- Test: `LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift`

**Interfaces:**
- Consumes: `tier`, `label`, `lineFlags` (Tasks 1–2), `CostConfidenceRecipeInput` (Task 1), `CostLineInput` (Task 2).
- Produces: output types `CostConfidenceLine`, `CostConfidenceRecipe`, `CostConfidenceSummary`, `CostConfidenceResult`; and `CostConfidenceCompute.summarize(recipes:lines:) -> CostConfidenceResult`. Task 4 (repo) and Task 5 (view) consume `CostConfidenceResult`.

- [ ] **Step 1: Write the failing test**

Append to `CostConfidenceComputeTests.swift`:

```swift
extension CostConfidenceComputeTests {

    func testSummarizeRanksWorstFirstAndCounts() {
        let recipes = [
            CostConfidenceRecipeInput(recipeId: "clean1", recipeName: "Clean", batchCost: 10, costPerYieldUnit: 5,
                                      yieldUnit: "qt", costedLines: 3, totalLines: 3, interpretations: 0),
            CostConfidenceRecipeInput(recipeId: "est1", recipeName: "Est", batchCost: 27.56, costPerYieldUnit: 15.66,
                                      yieldUnit: "qt", costedLines: 8, totalLines: 8, interpretations: 4),
            CostConfidenceRecipeInput(recipeId: "inc1", recipeName: "Inc", batchCost: 4, costPerYieldUnit: 2,
                                      yieldUnit: "qt", costedLines: 6, totalLines: 8, interpretations: 0),
        ]
        let lines = [
            CostLineInput(recipeId: "est1", ingredient: "garlic", mapStatus: "mapped", gPerMl: 8.4, gPerUnit: nil, lineBatchShare: nil),
            CostLineInput(recipeId: "est1", ingredient: "salt", mapStatus: "NEEDS_DENSITY", gPerMl: nil, gPerUnit: nil, lineBatchShare: nil),
        ]
        let out = CostConfidenceCompute.summarize(recipes: recipes, lines: lines)

        // ranked worst-first: incomplete, then estimated, then clean
        XCTAssertEqual(out.recipes.map { $0.recipeId }, ["inc1", "est1", "clean1"])
        // summary counts
        XCTAssertEqual(out.summary.clean, 1)
        XCTAssertEqual(out.summary.estimated, 1)
        XCTAssertEqual(out.summary.incomplete, 1)
        XCTAssertEqual(out.summary.flagged, 1)   // est1 has a density-flagged line

        let est = out.recipes.first { $0.recipeId == "est1" }!
        XCTAssertEqual(est.tier, .estimated)
        XCTAssertEqual(est.estimatedLineCount, 4)     // interpretations
        XCTAssertEqual(est.totalLineCount, 8)
        XCTAssertTrue(est.hasGuardrailFlag)
        XCTAssertEqual(est.lines.first { $0.ingredient == "salt" }?.label, .needsDensity)
        XCTAssertEqual(est.lines.first { $0.ingredient == "garlic" }?.flags.count, 1)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LariatNative && swift test --filter CostConfidenceComputeTests`
Expected: FAIL — "no member 'summarize'" / unresolved output types.

- [ ] **Step 3: Write minimal implementation**

Append output types + `summarize` to `CostConfidenceCompute.swift`:

```swift
public struct CostConfidenceLine: Equatable, Sendable {
    public let ingredient: String?
    public let label: CostLineLabel
    public let flags: [String]
}

public struct CostConfidenceRecipe: Equatable, Sendable {
    public let recipeId: String
    public let recipeName: String?
    public let batchCost: Double?
    public let costPerYieldUnit: Double?
    public let yieldUnit: String?
    public let tier: CostConfidenceTier
    public let estimatedLineCount: Int   // interpretations ?? 0
    public let totalLineCount: Int       // total_lines ?? 0
    public let hasGuardrailFlag: Bool
    public let lines: [CostConfidenceLine]
}

public struct CostConfidenceSummary: Equatable, Sendable {
    public let clean: Int
    public let estimated: Int
    public let incomplete: Int
    public let flagged: Int
}

public struct CostConfidenceResult: Equatable, Sendable {
    public let recipes: [CostConfidenceRecipe]   // ranked worst-first
    public let summary: CostConfidenceSummary
}

public extension CostConfidenceCompute {
    static func summarize(recipes: [CostConfidenceRecipeInput], lines: [CostLineInput]) -> CostConfidenceResult {
        let linesByRecipe = Dictionary(grouping: lines, by: { $0.recipeId })

        var built: [CostConfidenceRecipe] = recipes.map { r in
            let rLines = (linesByRecipe[r.recipeId] ?? []).map { li in
                CostConfidenceLine(ingredient: li.ingredient, label: label(mapStatus: li.mapStatus), flags: lineFlags(li))
            }
            let flagged = rLines.contains { !$0.flags.isEmpty }
            return CostConfidenceRecipe(
                recipeId: r.recipeId, recipeName: r.recipeName, batchCost: r.batchCost,
                costPerYieldUnit: r.costPerYieldUnit, yieldUnit: r.yieldUnit,
                tier: tier(costedLines: r.costedLines, totalLines: r.totalLines, interpretations: r.interpretations),
                estimatedLineCount: r.interpretations ?? 0,
                totalLineCount: r.totalLines ?? 0,
                hasGuardrailFlag: flagged,
                lines: rLines)
        }

        // worst-first: tier asc (Comparable ranks worst lowest), then more estimated lines, then name.
        built.sort { a, b in
            if a.tier != b.tier { return a.tier < b.tier }
            if a.estimatedLineCount != b.estimatedLineCount { return a.estimatedLineCount > b.estimatedLineCount }
            return (a.recipeName ?? a.recipeId) < (b.recipeName ?? b.recipeId)
        }

        let summary = CostConfidenceSummary(
            clean: built.filter { $0.tier == .clean }.count,
            estimated: built.filter { $0.tier == .estimated }.count,
            incomplete: built.filter { $0.tier == .incomplete }.count,
            flagged: built.filter { $0.hasGuardrailFlag }.count)

        return CostConfidenceResult(recipes: built, summary: summary)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LariatNative && swift test --filter CostConfidenceComputeTests`
Expected: PASS (all compute tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/Compute/CostConfidenceCompute.swift \
        LariatNative/Tests/LariatModelTests/CostConfidenceComputeTests.swift
AGENT_NAME=claude git commit -m "T3: summarize() ranked recipes + summary (cost confidence)"
```

---

## Task 4: CostingRepository.fetchCostConfidence

**Files:**
- Modify: `LariatNative/Sources/LariatDB/CostingRepository.swift`
- Test: `LariatNative/Tests/LariatDBTests/CostConfidenceRepositoryTests.swift` (create)

**Interfaces:**
- Consumes: `CostConfidenceCompute.summarize`, `CostConfidenceRecipeInput`, `CostLineInput`, `CostConfidenceResult` (Tasks 1–3).
- Produces: `static func fetchCostConfidence(db: Database, locationId: String) throws -> CostConfidenceResult`. Task 5's view calls this via the repository.

**Notes for the implementer:**
- Follow the existing read style in this file: `Row.fetchAll(db, sql:…, arguments:[locationId]).map { r in … r["col"] }`, guarded by `db.tableExists(…)`. See `fetchRecipeCostVariance` (`CostingRepository.swift:178`) as the template.
- recipe_costs read = the same shape as line 185 **plus** `costed_lines, total_lines, interpretations`, filtered `WHERE location_id = ? AND recipe_id <> 'TOTAL'`.
- Density inputs join by normalized ingredient key: `ingredient_densities(ingredient_key, g_per_ml)` and `ingredient_unit_weights(ingredient_key, unit, g_per_unit)`. Use `IngredientKey.normalize(bomLine.ingredient)` (already in LariatModel) to match, mirroring `computeCostVariance`'s `normalizeIngredientKey(line.ingredient)` lookup. For unit-weight, pick the row whose `unit` matches the bom line unit (normalized); nil otherwise.
- `lineBatchShare`: reuse the per-line pricing already implemented for cost variance — price each line ($) exactly as `CostVarianceCompute` does, divide by the recipe's `batch_cost`; nil when the line can't be priced or batch_cost is 0/nil. If wiring the full pricing here is out of reach in one task, pass `lineBatchShare: nil` for all lines and note it in the commit — the dominant-line flag then simply doesn't fire (density + unit-weight flags still do), and the follow-on is a one-line repo change. Do **not** re-implement `UnitConvert`.
- Missing any of `recipe_costs`/`bom_lines` → return `CostConfidenceResult(recipes: [], summary: .init(clean:0,estimated:0,incomplete:0,flagged:0))`.

- [ ] **Step 1: Write the failing test**

Create `LariatNative/Tests/LariatDBTests/CostConfidenceRepositoryTests.swift`:

```swift
import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

final class CostConfidenceRepositoryTests: XCTestCase {

    private func makeDB() throws -> DatabaseQueue {
        let db = try DatabaseQueue()
        try db.write { d in
            try d.execute(sql: """
                CREATE TABLE recipe_costs (id INTEGER PRIMARY KEY, recipe_id TEXT, recipe_name TEXT,
                    cost_per_yield_unit REAL, yield REAL, yield_unit TEXT, batch_cost REAL,
                    costed_lines INTEGER, total_lines INTEGER, interpretations INTEGER, location_id TEXT);
                CREATE TABLE bom_lines (id INTEGER PRIMARY KEY, recipe_id TEXT, ingredient TEXT,
                    unit TEXT, map_status TEXT, location_id TEXT);
                CREATE TABLE vendor_prices (id INTEGER PRIMARY KEY, location_id TEXT);
                INSERT INTO recipe_costs (recipe_id, recipe_name, cost_per_yield_unit, yield, yield_unit,
                    batch_cost, costed_lines, total_lines, interpretations, location_id)
                  VALUES ('aji_verde','Aji Verde',15.66,4,'qt',27.56,8,8,4,'default'),
                         ('clean_sauce','Clean',5.0,2,'qt',10.0,3,3,0,'default');
                INSERT INTO bom_lines (recipe_id, ingredient, unit, map_status, location_id)
                  VALUES ('aji_verde','garlic','cup','mapped','default'),
                         ('aji_verde','white pepper','tsp','cost_proxy_white_pepper','default');
                """)
        }
        return db
    }

    func testFetchCostConfidenceTiersAndLabels() throws {
        let db = try makeDB()
        let result = try db.read { d in
            try CostingRepository.fetchCostConfidence(db: d, locationId: "default")
        }
        XCTAssertEqual(result.summary.clean, 1)
        XCTAssertEqual(result.summary.estimated, 1)
        // ranked worst-first: estimated before clean
        XCTAssertEqual(result.recipes.map { $0.recipeId }, ["aji_verde", "clean_sauce"])
        let aji = result.recipes.first { $0.recipeId == "aji_verde" }!
        XCTAssertEqual(aji.tier, .estimated)
        XCTAssertEqual(aji.estimatedLineCount, 4)
        XCTAssertEqual(aji.lines.first { $0.ingredient == "white pepper" }?.label, .proxy)
    }

    func testMissingTablesDegradeToEmpty() throws {
        let db = try DatabaseQueue()
        let result = try db.read { d in
            try CostingRepository.fetchCostConfidence(db: d, locationId: "default")
        }
        XCTAssertTrue(result.recipes.isEmpty)
        XCTAssertEqual(result.summary.clean, 0)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LariatNative && swift test --filter CostConfidenceRepositoryTests`
Expected: FAIL — "type 'CostingRepository' has no member 'fetchCostConfidence'".

- [ ] **Step 3: Write minimal implementation**

Add to `CostingRepository.swift` (near `fetchRecipeCostVariance`):

```swift
static func fetchCostConfidence(db: Database, locationId: String) throws -> CostConfidenceResult {
    let empty = CostConfidenceResult(recipes: [],
        summary: CostConfidenceSummary(clean: 0, estimated: 0, incomplete: 0, flagged: 0))
    guard try db.tableExists("recipe_costs"), try db.tableExists("bom_lines") else { return empty }

    let recipes: [CostConfidenceRecipeInput] = try Row.fetchAll(db, sql: """
            SELECT recipe_id, recipe_name, cost_per_yield_unit, yield_unit, batch_cost,
                   costed_lines, total_lines, interpretations
              FROM recipe_costs
             WHERE location_id = ? AND recipe_id <> 'TOTAL'
             ORDER BY id
            """, arguments: [locationId]).map { r in
        CostConfidenceRecipeInput(
            recipeId: r["recipe_id"], recipeName: r["recipe_name"], batchCost: r["batch_cost"],
            costPerYieldUnit: r["cost_per_yield_unit"], yieldUnit: r["yield_unit"],
            costedLines: r["costed_lines"], totalLines: r["total_lines"], interpretations: r["interpretations"])
    }

    // Density/unit-weight lookups (global seed tables, no location scope) — same tables
    // computeCostVariance uses. Guarded so a partially-seeded DB still labels lines.
    var densityByKey: [String: Double] = [:]
    if try db.tableExists("ingredient_densities") {
        for r in try Row.fetchAll(db, sql: "SELECT ingredient_key, g_per_ml FROM ingredient_densities") {
            if let k: String = r["ingredient_key"], let v: Double = r["g_per_ml"] { densityByKey[k] = v }
        }
    }
    // (unit-weight map omitted here for brevity — build it the same way keyed by ingredient_key+unit)

    let lines: [CostLineInput] = try Row.fetchAll(db, sql: """
            SELECT recipe_id, ingredient, unit, map_status
              FROM bom_lines WHERE location_id = ? ORDER BY id
            """, arguments: [locationId]).map { r in
        let ingredient: String? = r["ingredient"]
        let key = ingredient.map { IngredientKey.normalize($0) }
        return CostLineInput(
            recipeId: r["recipe_id"], ingredient: ingredient, mapStatus: r["map_status"],
            gPerMl: key.flatMap { densityByKey[$0] }, gPerUnit: nil, lineBatchShare: nil)
    }

    return CostConfidenceCompute.summarize(recipes: recipes, lines: lines)
}
```

(Commit note: `lineBatchShare`/`gPerUnit` supplied as `nil` in this task — density flag + labels + tiers are live; dominant-line + unit-weight flags are a one-line follow-on. State this honestly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LariatNative && swift test --filter CostConfidenceRepositoryTests`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/CostingRepository.swift \
        LariatNative/Tests/LariatDBTests/CostConfidenceRepositoryTests.swift
AGENT_NAME=claude git commit -m "T4: CostingRepository.fetchCostConfidence (cost confidence)"
```

---

## Task 5: Native "Cost Confidence" board (A0 registration + view)

**Files:**
- Modify: `LariatNative/Sources/LariatModel/FeatureCatalog.swift` (after line 108, the `costing.components` descriptor)
- Modify: `LariatNative/Sources/LariatApp/CostingFeatures.swift`
- Modify: `LariatNative/Sources/LariatApp/FeatureRegistry.swift` (after line 66, `.costingComponents`)
- Create: `LariatNative/Sources/LariatApp/CostConfidenceView.swift`

**Interfaces:**
- Consumes: `CostingRepository.fetchCostConfidence` (Task 4), `CostConfidenceResult` (Task 3), `BoardPoller`, `LariatDatabase`, `AppContext`.
- Produces: feature id `"costing.confidence"`; `CostConfidenceView(database:)`.

**Verification for this task is `swift build`** (LariatApp has no unit-test target — state this in the commit).

- [ ] **Step 1: Register the descriptor**

In `FeatureCatalog.swift`, add after the `costing.components` line:

```swift
FeatureDescriptor(id: "costing.confidence", tier: .costing, title: "Cost confidence"),
```

- [ ] **Step 2: Add the feature module**

In `CostingFeatures.swift`, add inside the extension:

```swift
static let costingConfidence = FeatureModule(id: "costing.confidence") { ctx in
    AnyView(CostConfidenceView(database: ctx.database))
}
```

- [ ] **Step 3: List it in the registry**

In `FeatureRegistry.swift`, add after `.costingComponents,`:

```swift
        .costingConfidence,
```

- [ ] **Step 4: Create the view**

Create `LariatNative/Sources/LariatApp/CostConfidenceView.swift`:

```swift
import SwiftUI
import LariatDB
import LariatModel

@Observable @MainActor final class CostConfidenceViewModel {
    var result: CostConfidenceResult?
    var errorText: String?
    let poller = BoardPoller()
    private let database: LariatDatabase
    init(database: LariatDatabase) { self.database = database }

    func start() {
        let db = database
        poller.start(interval: .seconds(3)) { [weak self] in
            do {
                let r = try db.read { d in try CostingRepository.fetchCostConfidence(db: d, locationId: "default") }
                self?.result = r; self?.errorText = nil
            } catch {
                self?.errorText = "Fetch error: \(error.localizedDescription)"; throw error
            }
        }
    }
    func stop() { poller.stop() }
}

struct CostConfidenceView: View {
    @State private var vm: CostConfidenceViewModel
    init(database: LariatDatabase) { _vm = State(wrappedValue: CostConfidenceViewModel(database: database)) }

    var body: some View {
        Group {
            if let r = vm.result {
                List {
                    Section {
                        Text("\(r.summary.clean) clean · \(r.summary.estimated) estimated · \(r.summary.incomplete) incomplete")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(r.recipes, id: \.recipeId) { recipe in
                        DisclosureGroup {
                            ForEach(Array(recipe.lines.enumerated()), id: \.offset) { _, line in
                                HStack {
                                    Text(line.ingredient ?? "—")
                                    Spacer()
                                    Text(lineLabelText(line.label)).foregroundStyle(.secondary)
                                    if !line.flags.isEmpty { Text("⚠").foregroundStyle(.orange) }
                                }
                                if let reason = line.flags.first {
                                    Text(reason).font(.caption).foregroundStyle(.orange)
                                }
                            }
                        } label: {
                            HStack {
                                Circle().fill(tierColor(recipe.tier)).frame(width: 10, height: 10)
                                VStack(alignment: .leading) {
                                    Text(recipe.recipeName ?? recipe.recipeId)
                                    Text(rowSubtitle(recipe)).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if recipe.hasGuardrailFlag { Text("⚠ verify").font(.caption).foregroundStyle(.orange) }
                            }
                        }
                    }
                }
                .navigationTitle("Cost confidence")
            } else if let err = vm.errorText {
                EmptyState(title: "Costing unavailable", message: err)
            } else {
                ProgressView()
            }
        }
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
    }

    private func tierColor(_ t: CostConfidenceTier) -> Color {
        switch t { case .clean: return .green; case .estimated: return .yellow; case .incomplete: return .red; case .unknown: return .gray }
    }
    private func lineLabelText(_ l: CostLineLabel) -> String {
        switch l { case .mapped: return "mapped"; case .proxy: return "proxy"; case .placeholder: return "placeholder"
                   case .needsDensity: return "needs density"; case .unmapped: return "unmapped"; case .other: return "—" }
    }
    private func rowSubtitle(_ r: CostConfidenceRecipe) -> String {
        switch r.tier {
        case .clean: return "Clean"
        case .estimated: return "Estimated · \(r.estimatedLineCount) of \(r.totalLineCount) lines estimated"
        case .incomplete: return "Incomplete · not all lines costed"
        case .unknown: return "Not yet analyzed"
        }
    }
}
```

- [ ] **Step 5: Verify build + full suite**

Run: `cd LariatNative && swift build && swift test`
Expected: build clean; all tests pass (compute + repo tests from Tasks 1–4 included).

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatModel/FeatureCatalog.swift \
        LariatNative/Sources/LariatApp/CostingFeatures.swift \
        LariatNative/Sources/LariatApp/FeatureRegistry.swift \
        LariatNative/Sources/LariatApp/CostConfidenceView.swift
AGENT_NAME=claude git commit -m "T5: native Cost Confidence board (build-verified; no App test target)"
```

---

## Task 6: Additive tier dot on existing recipe lists

**Files:**
- Modify: `LariatNative/Sources/LariatApp/MenuEngineeringView.swift`

**Interfaces:**
- Consumes: `CostConfidenceTier`, `CostConfidenceCompute.tier` (Tasks 1). Reuses the `MenuEngineeringViewModel`'s existing recipe rows; derive the tier from the row's `costed/total/interpretations` if present, else `.unknown`.

**Verification is `swift build`** (view-only; no App test target). Keep the change strictly additive — a small leading `Circle()` dot; no layout restructuring, no compute/VM change.

- [ ] **Step 1: Add the dot**

In the recipe-row builder of `MenuEngineeringView.swift`, prepend a dot that reads the tier (add a `tier` accessor on the row if the fields are available; otherwise skip a row cleanly with `.unknown` gray):

```swift
Circle()
    .fill(costTierColor(CostConfidenceCompute.tier(costedLines: row.costedLines,
                                                   totalLines: row.totalLines,
                                                   interpretations: row.interpretations)))
    .frame(width: 8, height: 8)
    .accessibilityHidden(true)
```

with a local helper:

```swift
private func costTierColor(_ t: CostConfidenceTier) -> Color {
    switch t { case .clean: return .green; case .estimated: return .yellow; case .incomplete: return .red; case .unknown: return .gray }
}
```

(If `MenuEngineeringRow` does not carry `costed/total/interpretations`, this task's scope shrinks to wiring them through the existing repository read — or defer the dot to a follow-on and note it. Do not add a second DB read.)

- [ ] **Step 2: Verify build**

Run: `cd LariatNative && swift build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add LariatNative/Sources/LariatApp/MenuEngineeringView.swift
AGENT_NAME=claude git commit -m "T6: additive cost-confidence tier dot on recipe rows (build-verified)"
```

---

## Task 7: Web parity — lib/costConfidence.mjs + oracle + /costing display

**Files:**
- Create: `lib/costConfidence.mjs`
- Create: `tests/js/test-cost-confidence.mjs`
- Modify: the costing dashboard page (`app/costing/page.jsx` or its data component)

**Interfaces:**
- Produces: `computeCostConfidence(recipes, lines)` returning `{ recipes: [...ranked], summary: { clean, estimated, incomplete, flagged } }` — the SAME rules and thresholds as the Swift compute (Global Constraints). This is the parity oracle.

- [ ] **Step 1: Write the failing test**

Create `tests/js/test-cost-confidence.mjs`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostConfidence } from '../../lib/costConfidence.mjs';

describe('computeCostConfidence — parity with native CostConfidenceCompute', () => {
  it('tiers + worst-first ranking + summary', () => {
    const recipes = [
      { recipe_id: 'clean1', recipe_name: 'Clean', batch_cost: 10, costed_lines: 3, total_lines: 3, interpretations: 0 },
      { recipe_id: 'est1', recipe_name: 'Est', batch_cost: 27.56, costed_lines: 8, total_lines: 8, interpretations: 4 },
      { recipe_id: 'inc1', recipe_name: 'Inc', batch_cost: 4, costed_lines: 6, total_lines: 8, interpretations: 0 },
    ];
    const lines = [
      { recipe_id: 'est1', ingredient: 'garlic', map_status: 'mapped', g_per_ml: 8.4 },
      { recipe_id: 'est1', ingredient: 'salt', map_status: 'NEEDS_DENSITY' },
    ];
    const out = computeCostConfidence(recipes, lines);
    assert.deepEqual(out.recipes.map(r => r.recipe_id), ['inc1', 'est1', 'clean1']);
    assert.deepEqual(out.summary, { clean: 1, estimated: 1, incomplete: 1, flagged: 1 });
    const est = out.recipes.find(r => r.recipe_id === 'est1');
    assert.equal(est.tier, 'estimated');
    assert.equal(est.estimated_line_count, 4);
    assert.equal(est.lines.find(l => l.ingredient === 'salt').label, 'needsDensity');
    assert.equal(est.lines.find(l => l.ingredient === 'garlic').flags.length, 1);
  });

  it('density band edges + dominant-line strict >0.60', () => {
    const flags = (l) => computeCostConfidence([{ recipe_id: 'r', costed_lines: 1, total_lines: 1, interpretations: 0 }],
      [{ recipe_id: 'r', ...l }]).recipes[0].lines[0].flags;
    assert.equal(flags({ g_per_ml: 2.0 }).length, 0);
    assert.equal(flags({ g_per_ml: 8.4 }).length, 1);
    assert.equal(flags({ line_batch_share: 0.60 }).length, 0);
    assert.equal(flags({ line_batch_share: 0.61 }).length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-cost-confidence.mjs`
Expected: FAIL — cannot find module `lib/costConfidence.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/costConfidence.mjs` mirroring the Swift compute exactly:

```javascript
// Pure cost-trust computation — parity port of Swift LariatModel/CostConfidenceCompute.
// Keep every threshold identical to the Swift constants (Global Constraints).
export const DENSITY_MIN = 0.2, DENSITY_MAX = 2.0;
export const UNIT_WEIGHT_MIN = 1.0, UNIT_WEIGHT_MAX = 5000.0;
export const DOMINANT_LINE_SHARE = 0.60;

const TIER_RANK = { incomplete: 0, estimated: 1, unknown: 2, clean: 3 };

export function tierOf(costed, total, interp) {
  if (costed == null || total == null || interp == null) return 'unknown';
  if (costed < total) return 'incomplete';
  return interp > 0 ? 'estimated' : 'clean';
}

export function labelOf(mapStatus) {
  if (mapStatus == null) return 'other';
  if (mapStatus === 'mapped') return 'mapped';
  if (mapStatus === 'UNMAPPED') return 'unmapped';
  if (mapStatus === 'NEEDS_DENSITY') return 'needsDensity';
  if (mapStatus.startsWith('cost_proxy')) return 'proxy';
  if (mapStatus.startsWith('plan')) return 'placeholder';
  return 'other';
}

function trim(x) { return Number.isInteger(x) ? String(x) : String(x); }

export function lineFlags(line) {
  const flags = [];
  if (line.g_per_ml != null && (line.g_per_ml < DENSITY_MIN || line.g_per_ml > DENSITY_MAX))
    flags.push(`check density: ${trim(line.g_per_ml)} g/ml`);
  if (line.g_per_unit != null && (line.g_per_unit < UNIT_WEIGHT_MIN || line.g_per_unit > UNIT_WEIGHT_MAX))
    flags.push(`check unit weight: ${trim(line.g_per_unit)} g`);
  if (line.line_batch_share != null && line.line_batch_share > DOMINANT_LINE_SHARE)
    flags.push(`one line is ${Math.round(line.line_batch_share * 100)}% of batch cost — verify`);
  return flags;
}

export function computeCostConfidence(recipes, lines) {
  const byRecipe = new Map();
  for (const l of lines) {
    if (!byRecipe.has(l.recipe_id)) byRecipe.set(l.recipe_id, []);
    byRecipe.get(l.recipe_id).push({ ingredient: l.ingredient ?? null, label: labelOf(l.map_status), flags: lineFlags(l) });
  }
  const built = recipes.map(r => {
    const rl = byRecipe.get(r.recipe_id) ?? [];
    const tier = tierOf(r.costed_lines, r.total_lines, r.interpretations);
    return {
      recipe_id: r.recipe_id, recipe_name: r.recipe_name ?? null, batch_cost: r.batch_cost ?? null,
      cost_per_yield_unit: r.cost_per_yield_unit ?? null, tier,
      estimated_line_count: r.interpretations ?? 0, total_line_count: r.total_lines ?? 0,
      has_guardrail_flag: rl.some(l => l.flags.length > 0), lines: rl,
    };
  });
  built.sort((a, b) =>
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    b.estimated_line_count - a.estimated_line_count ||
    (a.recipe_name ?? a.recipe_id).localeCompare(b.recipe_name ?? b.recipe_id));
  const summary = {
    clean: built.filter(r => r.tier === 'clean').length,
    estimated: built.filter(r => r.tier === 'estimated').length,
    incomplete: built.filter(r => r.tier === 'incomplete').length,
    flagged: built.filter(r => r.has_guardrail_flag).length,
  };
  return { recipes: built, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-cost-confidence.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the /costing display (build-verified)**

In the costing dashboard page, read `recipe_costs` (incl. the 3 columns) + per-recipe `bom_lines.map_status` + density rows, call `computeCostConfidence`, and render the badge (`{clean} clean · {estimated} estimated · {incomplete} incomplete`) + the ranked section, mirroring the native copy. Verify: `npm run typecheck` + `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add lib/costConfidence.mjs tests/js/test-cost-confidence.mjs app/costing/
git commit -m "T7: web cost-confidence parity oracle + /costing display"
```

---

## Task 8: Docs — status + follow-on worklist

**Files:**
- Modify: `docs/superpowers/specs/2026-07-07-lariat-cost-confidence-triage-design.md` (mark Status: Implemented)
- Modify: `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md` (add the Cost Confidence board + the A/C data-ops worklist pointer)

- [ ] **Step 1: Update the spec status + append the data-ops worklist** (the 9 NEEDS_DENSITY / 13 UNMAPPED / placeholder list this board now surfaces) as the follow-on for owner/data curation.

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "T8: cost-confidence docs — status + data-ops worklist"
```

---

## Self-Review

**Spec coverage:** §3 confidence model → T1 (tiers) + T2 (labels) + T3 (summary/ranking); §4 data layer → T4 (repo read) + T7 (web read); §5a native board → T5; §5b web → T7; §6 guardrail → T2 (rules) + T4 (density wiring); §7 testing → T1–T4 unit/repo tests, T5/T6 build-verified, T7 web oracle; §8 follow-on worklist → T8. No spec section is unassigned.

**Placeholder scan:** the only deliberate deferral is `lineBatchShare`/`gPerUnit` = nil in T4 (dominant-line + unit-weight flags), explicitly flagged as a one-line follow-on with the reason (avoid re-implementing UnitConvert in one task); density flag + tiers + labels are fully live. T6 carries a conditional scope note if `MenuEngineeringRow` lacks the confidence fields. No "TODO/TBD/handle edge cases" placeholders.

**Type consistency:** `CostConfidenceTier` (.clean/.estimated/.incomplete/.unknown), `CostLineLabel` (.mapped/.proxy/.placeholder/.needsDensity/.unmapped/.other), `CostConfidenceRecipeInput`, `CostLineInput` (with `lineBatchShare`), `CostConfidenceResult`/`Recipe`/`Line`/`Summary`, and `fetchCostConfidence` are used identically across T1–T7. Web mirror uses snake_case (`recipe_id`, `estimated_line_count`, `line_batch_share`) consistently and the same tier/label string values.
