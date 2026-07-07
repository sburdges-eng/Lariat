import XCTest
@testable import LariatModel

// The purchasing order-guide print computation is a native-only nicety —
// `app/purchasing/page.jsx` has no print/export view, so unlike
// `SettlementPrintComputeTests` there is no web parity oracle to port.
// These cases pin the native contract directly: header presence, per-row
// field coverage, alignment, empty/nil handling, and money/qty formatting.
final class PurchasingOrderGuidePrintComputeTests: XCTestCase {

    private func row(
        ingredient: String = "Flour",
        baseQty: Double? = 50,
        unit: String? = "lb",
        vendor: String? = "Sysco",
        unitPrice: Double? = 12.34
    ) -> EnrichedOrderGuideRow {
        EnrichedOrderGuideRow(
            id: 0,
            row: OrderGuideItemRow(
                ingredient: ingredient, baseQty: baseQty, unit: unit,
                vendor: vendor, unitPrice: unitPrice
            ),
            enrichment: nil
        )
    }

    func testContainsTitleHeader() {
        let summary = OrderGuideSummary(totalCount: 1, rows: [row()])
        XCTAssertTrue(PurchasingOrderGuidePrintCompute.renderText(summary).contains("PURCHASING ORDER GUIDE"))
    }

    func testRendersRowWithIngredientQtyUnitVendorPrice() {
        let summary = OrderGuideSummary(totalCount: 1, rows: [row()])
        let text = PurchasingOrderGuidePrintCompute.renderText(summary)
        XCTAssertTrue(text.contains("Flour"))
        XCTAssertTrue(text.contains("50"))
        XCTAssertTrue(text.contains("lb"))
        XCTAssertTrue(text.contains("Sysco"))
        XCTAssertTrue(text.contains("$12.34"))
    }

    func testRowsAreAlignedOneLinePerItem() {
        let summary = OrderGuideSummary(totalCount: 2, rows: [
            row(ingredient: "Flour", baseQty: 50, unit: "lb", vendor: "Sysco", unitPrice: 12.34),
            row(ingredient: "Salt", baseQty: 5, unit: "bag", vendor: "Shamrock", unitPrice: 3.5),
        ])
        let text = PurchasingOrderGuidePrintCompute.renderText(summary)
        let lines = text.components(separatedBy: "\n")
        guard let flourLine = lines.first(where: { $0.contains("Flour") }),
              let saltLine = lines.first(where: { $0.contains("Salt") }) else {
            return XCTFail("expected one line per row")
        }
        // Aligned columns: the vendor column starts at the same offset on
        // every row.
        XCTAssertEqual(flourLine.range(of: "Sysco")?.lowerBound.utf16Offset(in: flourLine),
                        saltLine.range(of: "Shamrock")?.lowerBound.utf16Offset(in: saltLine))
    }

    func testEmptyRowsShowsEmptyState() {
        let summary = OrderGuideSummary(totalCount: 0, rows: [])
        let text = PurchasingOrderGuidePrintCompute.renderText(summary)
        XCTAssertTrue(text.lowercased().contains("no order guide rows"))
    }

    func testNilFieldsRenderAsEmDash() {
        let summary = OrderGuideSummary(totalCount: 1, rows: [
            row(baseQty: nil, unit: nil, vendor: nil, unitPrice: nil),
        ])
        let text = PurchasingOrderGuidePrintCompute.renderText(summary)
        XCTAssertTrue(text.contains("—"))
    }

    func testQtyFormattingTrimsTrailingZero() {
        XCTAssertEqual(PurchasingOrderGuidePrintCompute.qtyText(50.0), "50")
        XCTAssertEqual(PurchasingOrderGuidePrintCompute.qtyText(2.5), "2.5")
        XCTAssertEqual(PurchasingOrderGuidePrintCompute.qtyText(nil), "—")
    }

    func testPriceFormattingMatchesDollarsGrouping() {
        XCTAssertEqual(PurchasingOrderGuidePrintCompute.priceText(12.3), "$12.30")
        XCTAssertEqual(PurchasingOrderGuidePrintCompute.priceText(1234.5), "$1,234.50")
        XCTAssertEqual(PurchasingOrderGuidePrintCompute.priceText(nil), "—")
    }

    func testShowsTotalCountAndRowsShown() {
        let summary = OrderGuideSummary(totalCount: 250, rows: [row(), row(ingredient: "Salt")])
        let text = PurchasingOrderGuidePrintCompute.renderText(summary)
        XCTAssertTrue(text.contains("250"))
        XCTAssertTrue(text.contains("Showing 2 of 250"))
    }
}
