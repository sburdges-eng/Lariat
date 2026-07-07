import XCTest
@testable import LariatModel

// The standing prep-par print computation is a native-only nicety —
// `app/prep/par/page.jsx` has no print/export view, so unlike
// `SettlementPrintComputeTests` there is no web parity oracle to port
// (same situation as `PurchasingOrderGuidePrintComputeTests`). These cases
// pin the native contract directly: title/count header, station-group
// headers, per-row field coverage, alignment across groups, empty state,
// and qty formatting (no money on this board — `target_qty` is a plain
// quantity, never dollars).
final class PrepParPrintComputeTests: XCTestCase {

    private func row(
        id: Int64 = 1,
        station: String = "grill",
        recipe: String = "",
        ingredient: String = "",
        targetQty: Double? = 12,
        unit: String? = "lb",
        note: String? = nil
    ) -> PrepParRow {
        PrepParRow(
            id: id, locationId: "default", stationId: station,
            recipeSlug: recipe, ingredient: ingredient,
            targetQty: targetQty, unit: unit, sortOrder: 0, note: note, updatedAt: nil
        )
    }

    private func snapshot(_ rows: [PrepParRow]) -> PrepParBoardSnapshot {
        PrepParBoardSnapshot(
            locationId: "default", stationFilter: nil, rows: rows,
            groups: PrepParCompute.group(rows)
        )
    }

    func testContainsTitleHeaderAndCount() {
        let rows = [
            row(id: 1, station: "grill", recipe: "ribeye-8oz"),
            row(id: 2, station: "cold", ingredient: "roma tomatoes"),
        ]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("STANDING PREP PAR"))
        XCTAssertTrue(text.contains("2 targets on file"))
    }

    func testSingularCountHasNoTrailingS() {
        let text = PrepParPrintCompute.renderText(snapshot([row(id: 1)]))
        XCTAssertTrue(text.contains("1 target on file"))
    }

    func testStationGroupHeadersAppearUppercased() {
        let rows = [
            row(id: 1, station: "grill", recipe: "ribeye-8oz"),
            row(id: 2, station: "", ingredient: "salt"),
        ]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("GRILL"))
        XCTAssertTrue(text.contains("GENERAL")) // '' station folds into General
    }

    func testRendersRowWithLabelQtyUnitStationAndNote() {
        let rows = [
            row(id: 1, station: "grill", recipe: "ribeye-8oz", targetQty: 12, unit: "portions",
                note: "keep chilled"),
        ]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("ribeye-8oz"))
        XCTAssertTrue(text.contains("12"))
        XCTAssertTrue(text.contains("portions"))
        XCTAssertTrue(text.contains("grill"))
        XCTAssertTrue(text.contains("keep chilled"))
    }

    func testLabelFallsBackToIngredientWhenRecipeEmpty() {
        let rows = [row(id: 1, station: "cold", ingredient: "roma tomatoes")]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("roma tomatoes"))
    }

    func testRowsAreAlignedAcrossStationGroups() {
        let rows = [
            row(id: 1, station: "grill", recipe: "ribeye-8oz", targetQty: 12, unit: "portions"),
            row(id: 2, station: "cold", ingredient: "roma tomatoes", targetQty: 20, unit: "lbs"),
        ]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        let lines = text.components(separatedBy: "\n")
        guard let ribeyeLine = lines.first(where: { $0.contains("ribeye-8oz") }),
              let tomatoLine = lines.first(where: { $0.contains("roma tomatoes") }) else {
            return XCTFail("expected one line per row")
        }
        // Aligned columns: the station column starts at the same offset on
        // every row, even across different station groups.
        XCTAssertEqual(ribeyeLine.range(of: "grill")?.lowerBound.utf16Offset(in: ribeyeLine),
                        tomatoLine.range(of: "cold")?.lowerBound.utf16Offset(in: tomatoLine))
    }

    func testEmptyStateWhenNoTargets() {
        let text = PrepParPrintCompute.renderText(snapshot([]))
        XCTAssertTrue(text.lowercased().contains("no standing prep targets"))
    }

    func testNilUnitRendersEmDash() {
        let rows = [row(id: 1, recipe: "risotto", unit: nil)]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("—"))
    }

    func testNilTargetQtyRendersEmDash() {
        let rows = [row(id: 1, recipe: "risotto", targetQty: nil, unit: nil)]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("—"))
    }

    func testQtyFormattingTrimsTrailingZeroAndKeepsFraction() {
        // No money on this board, but this pins the same rounding-vs-truncation
        // distinction the T1 review flagged: a fractional target (2.53) must
        // render exactly, not rounded/truncated to 2 or 3.
        let rows = [
            row(id: 1, station: "grill", recipe: "whole-target", targetQty: 12.0, unit: "lb"),
            row(id: 2, station: "grill", recipe: "fractional-target", targetQty: 2.53, unit: "lb"),
        ]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("12"))
        XCTAssertFalse(text.contains("12.0"))
        XCTAssertTrue(text.contains("2.53"))
    }

    func testNoteOmittedWhenNil() {
        let rows = [row(id: 1, recipe: "risotto", note: nil)]
        let text = PrepParPrintCompute.renderText(snapshot(rows))
        XCTAssertTrue(text.contains("risotto"))
    }
}
