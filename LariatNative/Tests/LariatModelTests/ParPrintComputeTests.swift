import XCTest
@testable import LariatModel

// ParPrintCompute is a native-only nicety shared by BOTH `/bar/par` and
// `/inventory/par` — neither web page has a print/export view, so like
// `PrepParPrintComputeTests` / `PurchasingOrderGuidePrintComputeTests` there
// is no web parity oracle to port. These cases pin the shared native
// contract: title header, category-group headers, per-row field coverage
// (below-par marker), alignment across groups, empty state, and qty
// formatting (no money on either board — par/on-hand are plain quantities).
// The `barRow`/`inventoryRow` helpers below map a bar-par-shaped row and an
// inventory-par-shaped row into the SAME `ParPrintRow`/`ParPrintGroup`
// inputs — proving one renderer serves both boards.
final class ParPrintComputeTests: XCTestCase {

    /// Mirrors `BarParRow` → `ParPrintRow` (the `isLow` rule from
    /// `BarParRow.isLow`: below par only when both par and on-hand exist).
    private func barRow(
        ingredient: String = "Tito's Vodka",
        parQty: Double? = 12,
        onHandQty: Double? = 20,
        unit: String? = "btl"
    ) -> ParPrintRow {
        let isLow: Bool = {
            guard let parQty, let onHandQty else { return false }
            return onHandQty < parQty
        }()
        return ParPrintRow(name: ingredient, par: parQty, onHand: onHandQty, unit: unit, belowPar: isLow)
    }

    /// Mirrors `InventoryParWithOnHand` → `ParPrintRow` (uses the real
    /// `InventoryParCompute.isLowPar` rule, same as the view model's `isLow`).
    private func inventoryRow(
        ingredient: String = "Flour",
        parQty: Double? = 50,
        onHandQty: Double? = 10,
        unit: String? = "lb"
    ) -> ParPrintRow {
        ParPrintRow(
            name: ingredient, par: parQty, onHand: onHandQty, unit: unit,
            belowPar: InventoryParCompute.isLowPar(parQty: parQty, onHand: onHandQty)
        )
    }

    func testContainsTitleHeaderAndCount() {
        let groups = [ParPrintGroup(category: "Liquor", rows: [barRow(), barRow(ingredient: "Jameson")])]
        let text = ParPrintCompute.renderText(title: "BAR PAR", groups: groups)
        XCTAssertTrue(text.contains("BAR PAR"))
        XCTAssertTrue(text.contains("2 items on file"))
    }

    func testSingularCountHasNoTrailingS() {
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [barRow()])]
        )
        XCTAssertTrue(text.contains("1 item on file"))
    }

    func testCategoryGroupHeadersAppear() {
        let groups = [
            ParPrintGroup(category: "Beer", rows: [barRow(ingredient: "Lager")]),
            ParPrintGroup(category: "Dry Goods", rows: [inventoryRow(ingredient: "Flour")]),
        ]
        let text = ParPrintCompute.renderText(title: "BAR PAR", groups: groups)
        XCTAssertTrue(text.contains("Beer"))
        XCTAssertTrue(text.contains("Dry Goods"))
    }

    func testRendersRowWithNameParOnHandAndUnit() {
        let row = barRow(ingredient: "Tito's Vodka", parQty: 12, onHandQty: 20, unit: "btl")
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [row])]
        )
        XCTAssertTrue(text.contains("Tito's Vodka"))
        XCTAssertTrue(text.contains("12"))
        XCTAssertTrue(text.contains("20"))
        XCTAssertTrue(text.contains("btl"))
    }

    func testBelowParMarkerOnlyOnBelowParRows() {
        let low = ParPrintRow(name: "Low Item", par: 10, onHand: 2, unit: "ea", belowPar: true)
        let ok = ParPrintRow(name: "OK Item", par: 10, onHand: 15, unit: "ea", belowPar: false)
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [low, ok])]
        )
        let lines = text.components(separatedBy: "\n")
        guard let lowLine = lines.first(where: { $0.contains("Low Item") }),
              let okLine = lines.first(where: { $0.contains("OK Item") }) else {
            return XCTFail("expected one line per row")
        }
        XCTAssertTrue(lowLine.contains("LOW"))
        XCTAssertFalse(okLine.contains("LOW"))
    }

    func testRowsAreAlignedAcrossGroups() {
        let groups = [
            ParPrintGroup(category: "Liquor", rows: [barRow(ingredient: "Tito's Vodka", unit: "btl")]),
            ParPrintGroup(category: "Dry Goods", rows: [inventoryRow(ingredient: "Flour", unit: "lb")]),
        ]
        let text = ParPrintCompute.renderText(title: "BAR PAR", groups: groups)
        let lines = text.components(separatedBy: "\n")
        guard let vodkaLine = lines.first(where: { $0.contains("Tito's Vodka") }),
              let flourLine = lines.first(where: { $0.contains("Flour") }) else {
            return XCTFail("expected one line per row")
        }
        // Aligned columns: the unit column starts at the same offset on
        // every row, even across different category groups.
        XCTAssertEqual(vodkaLine.range(of: "btl")?.lowerBound.utf16Offset(in: vodkaLine),
                        flourLine.range(of: "lb")?.lowerBound.utf16Offset(in: flourLine))
    }

    func testEmptyStateWhenNoGroups() {
        let text = ParPrintCompute.renderText(title: "BAR PAR", groups: [])
        XCTAssertTrue(text.lowercased().contains("no par items"))
    }

    func testEmptyStateWhenGroupsHaveNoRows() {
        let text = ParPrintCompute.renderText(title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [])])
        XCTAssertTrue(text.lowercased().contains("no par items"))
    }

    func testNilParAndOnHandRenderAsEmDash() {
        let row = ParPrintRow(name: "Untracked", par: nil, onHand: nil, unit: nil, belowPar: false)
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [row])]
        )
        XCTAssertTrue(text.contains("—"))
    }

    func testFractionalParAndOnHandPinnedExactly() {
        // Fractional par/on-hand (2.5, 1.5) must render exactly, not
        // rounded/truncated to 2/3 or 1/2 — same distinction the T1 review
        // flagged for money, applied here to plain quantities.
        let row = ParPrintRow(name: "Half Case", par: 2.5, onHand: 1.5, unit: "cs", belowPar: false)
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [row])]
        )
        XCTAssertTrue(text.contains("2.5"))
        XCTAssertTrue(text.contains("1.5"))
    }

    func testIntegerParTrimsTrailingZero() {
        let row = ParPrintRow(name: "Whole Case", par: 12.0, onHand: 20.0, unit: "cs", belowPar: false)
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [row])]
        )
        XCTAssertTrue(text.contains("12"))
        XCTAssertFalse(text.contains("12.0"))
    }

    func testFeedsBothBarShapedAndInventoryShapedRowsThroughSameRenderer() {
        // One renderer, two board shapes: a BarParRow-mapped row and an
        // InventoryParWithOnHand-mapped row both flow through the same
        // `ParPrintCompute.renderText` call.
        let groups = [
            ParPrintGroup(category: "Liquor", rows: [
                barRow(ingredient: "Tito's Vodka", parQty: 12, onHandQty: 20, unit: "btl"),
            ]),
            ParPrintGroup(category: "Dry Goods", rows: [
                inventoryRow(ingredient: "Flour", parQty: 50, onHandQty: 10, unit: "lb"),
            ]),
        ]
        let text = ParPrintCompute.renderText(title: "PAR", groups: groups)
        XCTAssertTrue(text.contains("Tito's Vodka"))
        XCTAssertTrue(text.contains("Flour"))
        // Flour is below its 50 par at 10 on-hand — inventory-shaped LOW marker works.
        let flourLine = text.components(separatedBy: "\n").first(where: { $0.contains("Flour") })
        XCTAssertTrue(flourLine?.contains("LOW") ?? false)
    }
}
