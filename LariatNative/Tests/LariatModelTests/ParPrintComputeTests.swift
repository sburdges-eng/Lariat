import XCTest
@testable import LariatModel

// ParPrintCompute is a native-only nicety shared by BOTH `/bar/par` and
// `/inventory/par` — neither web page has a print/export view, so like
// `PrepParPrintComputeTests` / `PurchasingOrderGuidePrintComputeTests` there
// is no web parity oracle to port. These cases pin the shared native
// contract: title header, category-group headers, per-row field coverage
// (below-par marker), alignment across groups, empty state, and qty
// formatting (no money on either board — par/on-hand are plain quantities).
// Par and on-hand are tracked in INDEPENDENT units (`parUnit`/`onHandUnit`)
// — never collapsed to one shared "Unit" column, since a board's standing
// par and its latest counted on-hand can legitimately be denominated
// differently (par in "case", on-hand counted in "ea"). The `barRow`/
// `inventoryRow` helpers below map a bar-par-shaped row and an
// inventory-par-shaped row into the SAME `ParPrintRow`/`ParPrintGroup`
// inputs — proving one renderer serves both boards.
final class ParPrintComputeTests: XCTestCase {

    /// Mirrors `BarParRow` → `ParPrintRow` (the `isLow` rule from
    /// `BarParRow.isLow`: below par only when both par and on-hand exist).
    private func barRow(
        ingredient: String = "Tito's Vodka",
        parQty: Double? = 12,
        onHandQty: Double? = 20,
        parUnit: String? = "btl",
        onHandUnit: String? = "btl"
    ) -> ParPrintRow {
        let isLow: Bool = {
            guard let parQty, let onHandQty else { return false }
            return onHandQty < parQty
        }()
        return ParPrintRow(
            name: ingredient, par: parQty, onHand: onHandQty,
            parUnit: parUnit, onHandUnit: onHandUnit, belowPar: isLow
        )
    }

    /// Mirrors `InventoryParWithOnHand` → `ParPrintRow` (uses the real
    /// `InventoryParCompute.isLowPar` rule, same as the view model's `isLow`).
    private func inventoryRow(
        ingredient: String = "Flour",
        parQty: Double? = 50,
        onHandQty: Double? = 10,
        parUnit: String? = "lb",
        onHandUnit: String? = "lb"
    ) -> ParPrintRow {
        ParPrintRow(
            name: ingredient, par: parQty, onHand: onHandQty,
            parUnit: parUnit, onHandUnit: onHandUnit,
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

    func testRendersRowWithNameParOnHandAndUnits() {
        let row = barRow(ingredient: "Tito's Vodka", parQty: 12, onHandQty: 20, parUnit: "btl", onHandUnit: "btl")
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [row])]
        )
        XCTAssertTrue(text.contains("Tito's Vodka"))
        XCTAssertTrue(text.contains("12"))
        XCTAssertTrue(text.contains("20"))
        XCTAssertTrue(text.contains("btl"))
    }

    /// The exact case the old single-`unit` collapse would have mislabeled:
    /// par denominated in "pack" (e.g. a case) but on-hand counted in loose
    /// "ea". Both units must render — on their OWN quantity, not merged or
    /// dropped in favor of one shared column.
    func testParAndOnHandRenderTheirOwnDistinctUnits() {
        let row = ParPrintRow(
            name: "Napkins", par: 2, onHand: 40, parUnit: "pack", onHandUnit: "ea", belowPar: false
        )
        let text = ParPrintCompute.renderText(
            title: "INVENTORY PAR", groups: [ParPrintGroup(category: "Dry Goods", rows: [row])]
        )
        let line = text.components(separatedBy: "\n").first { $0.contains("Napkins") }
        XCTAssertNotNil(line)
        XCTAssertTrue(line?.contains("pack") ?? false)
        XCTAssertTrue(line?.contains("ea") ?? false)
    }

    func testBelowParMarkerOnlyOnBelowParRows() {
        let low = ParPrintRow(name: "Low Item", par: 10, onHand: 2, parUnit: "ea", onHandUnit: "ea", belowPar: true)
        let ok = ParPrintRow(name: "OK Item", par: 10, onHand: 15, parUnit: "ea", onHandUnit: "ea", belowPar: false)
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

    /// Alignment must hold at the COLUMN level (fixed-width padding), not
    /// because two rows happen to have same-length "qty unit" text — this
    /// deliberately varies both qty-digit-count and unit length across rows
    /// so the shared "Status" column still starts at the same offset.
    func testStatusColumnAlignsAcrossGroupsRegardlessOfContentLength() {
        let groups = [
            ParPrintGroup(category: "Liquor", rows: [
                ParPrintRow(name: "Tito's Vodka", par: 12, onHand: 20, parUnit: "btl", onHandUnit: "btl", belowPar: true),
            ]),
            ParPrintGroup(category: "Dry Goods", rows: [
                ParPrintRow(name: "Flour", par: 5, onHand: 1000, parUnit: "pounds", onHandUnit: "lb", belowPar: true),
            ]),
        ]
        let text = ParPrintCompute.renderText(title: "BAR PAR", groups: groups)
        let lines = text.components(separatedBy: "\n")
        guard let vodkaLine = lines.first(where: { $0.contains("Tito's Vodka") }),
              let flourLine = lines.first(where: { $0.contains("Flour") }) else {
            return XCTFail("expected one line per row")
        }
        XCTAssertEqual(vodkaLine.range(of: "LOW")?.lowerBound.utf16Offset(in: vodkaLine),
                        flourLine.range(of: "LOW")?.lowerBound.utf16Offset(in: flourLine))
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
        let row = ParPrintRow(name: "Untracked", par: nil, onHand: nil, parUnit: nil, onHandUnit: nil, belowPar: false)
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [row])]
        )
        XCTAssertTrue(text.contains("—"))
    }

    func testFractionalParAndOnHandPinnedExactly() {
        // Fractional par/on-hand (2.5, 1.5) must render exactly, not
        // rounded/truncated to 2/3 or 1/2 — same distinction the T1 review
        // flagged for money, applied here to plain quantities.
        let row = ParPrintRow(name: "Half Case", par: 2.5, onHand: 1.5, parUnit: "cs", onHandUnit: "cs", belowPar: false)
        let text = ParPrintCompute.renderText(
            title: "BAR PAR", groups: [ParPrintGroup(category: "Liquor", rows: [row])]
        )
        XCTAssertTrue(text.contains("2.5"))
        XCTAssertTrue(text.contains("1.5"))
    }

    func testIntegerParTrimsTrailingZero() {
        let row = ParPrintRow(name: "Whole Case", par: 12.0, onHand: 20.0, parUnit: "cs", onHandUnit: "cs", belowPar: false)
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
                barRow(ingredient: "Tito's Vodka", parQty: 12, onHandQty: 20, parUnit: "btl", onHandUnit: "btl"),
            ]),
            ParPrintGroup(category: "Dry Goods", rows: [
                inventoryRow(ingredient: "Flour", parQty: 50, onHandQty: 10, parUnit: "lb", onHandUnit: "lb"),
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
