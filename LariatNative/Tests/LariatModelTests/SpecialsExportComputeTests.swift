import XCTest
@testable import LariatModel

/// Value-parity with the pure-CSV half of `tests/js/test-specials-export.mjs`
/// (`lib/specialsExport.ts`). The route-layer half is pinned in
/// `LariatDBTests/SpecialsRepositoryTests`.
final class SpecialsExportComputeTests: XCTestCase {
    // MARK: escapeCsvField

    func testEscapeCsvField() {
        XCTAssertEqual(SpecialsExport.escapeCsvField("plain"), "plain")
        XCTAssertEqual(SpecialsExport.escapeCsvField("a,b"), "\"a,b\"")
        XCTAssertEqual(SpecialsExport.escapeCsvField("line1\nline2"), "\"line1\nline2\"")
        XCTAssertEqual(SpecialsExport.escapeCsvField("he said \"hi\""), "\"he said \"\"hi\"\"\"")
        XCTAssertEqual(SpecialsExport.escapeCsvField(nil), "")
    }

    func testNumberCoercionMatchesJs() {
        // JS String(12.5) → "12.5", String(2) → "2".
        XCTAssertEqual(JsValueFormat.numberString(12.5), "12.5")
        XCTAssertEqual(JsValueFormat.numberString(2), "2")
        XCTAssertEqual(JsValueFormat.numberString(0.5), "0.5")
        XCTAssertEqual(JsValueFormat.numberString(0.2607938891256041), "0.2607938891256041")
    }

    // MARK: mapCostBreakdownToIngredientRows

    private let breakdown: [CostBreakdownLine] = [
        CostBreakdownLine(item: "Pork Belly", reqQty: 2, reqUnit: "lb",
                          match: "Sysco Pork Belly Skin-On", cost: 10),
        CostBreakdownLine(item: "Tomato (soft)", reqQty: 0.5, reqUnit: "case",
                          match: "", cost: nil, note: "no vendor match"),
    ]

    func testMapsMatchedAndUnmatchedRows() {
        let rows = SpecialsExport.mapCostBreakdownToIngredientRows(breakdown)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0], SpecialsExport.IngredientRow(
            ingredient: "Pork Belly", qty: "2", unit: "lb",
            vendorMatch: "Sysco Pork Belly Skin-On", note: ""))
        XCTAssertEqual(rows[1], SpecialsExport.IngredientRow(
            ingredient: "Tomato (soft)", qty: "0.5", unit: "case",
            vendorMatch: "", note: "unmatched — pick a vendor item before paste"))
    }

    func testHandlesPartialRowsDefensively() {
        let rows = SpecialsExport.mapCostBreakdownToIngredientRows([CostBreakdownLine(item: "X")])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].ingredient, "X")
        XCTAssertEqual(rows[0].qty, "")
        XCTAssertEqual(rows[0].unit, "")
        XCTAssertEqual(rows[0].vendorMatch, "")
        XCTAssertEqual(rows[0].note, SpecialsExport.unmatchedNote)
    }

    func testMatchedRequiresBothMatchAndCost() {
        // A match string with a null cost is still unmatched (web truthiness).
        let rows = SpecialsExport.mapCostBreakdownToIngredientRows([
            CostBreakdownLine(item: "A", reqQty: 1, reqUnit: "lb", match: "VENDOR A", cost: nil),
        ])
        XCTAssertEqual(rows[0].vendorMatch, "")
        XCTAssertEqual(rows[0].note, SpecialsExport.unmatchedNote)
    }

    func testParseBreakdownToleratesMalformedJson() {
        XCTAssertEqual(CostBreakdownLine.parse(nil), [])
        XCTAssertEqual(CostBreakdownLine.parse("not json"), [])
        XCTAssertEqual(CostBreakdownLine.parse("{\"not\":\"array\"}"), [])
        XCTAssertEqual(CostBreakdownLine.parse("[]"), [])
    }

    // MARK: selectSkippedRows

    func testSelectSkippedRows() {
        let rows = [
            SpecialsExport.IngredientRow(ingredient: "A", qty: "1", unit: "lb", vendorMatch: "X", note: ""),
            SpecialsExport.IngredientRow(ingredient: "B", qty: "2", unit: "lb", vendorMatch: "",
                                         note: SpecialsExport.unmatchedNote),
        ]
        XCTAssertEqual(SpecialsExport.selectSkippedRows(rows), [rows[1]])
    }

    // MARK: stripCostMarkdown

    func testStripsTrailingNoteBlock() {
        let ans = "Sear belly.\nSeason it.\n\n> [!NOTE]\n> ⚡ COMPUTED RECIPE COST: $10.00\n>\n> | x | y |\n"
        XCTAssertEqual(SpecialsExport.stripCostMarkdown(ans), "Sear belly.\nSeason it.")
    }

    func testStripsTrailingWarningBlock() {
        let ans = "Sear belly.\n\n> [!WARNING]\n> Could not compute deterministic cost: foo"
        XCTAssertEqual(SpecialsExport.stripCostMarkdown(ans), "Sear belly.")
    }

    func testLeavesPlainAnswersAlone() {
        XCTAssertEqual(SpecialsExport.stripCostMarkdown("Plain answer."), "Plain answer.")
    }

    // MARK: buildExportCsv

    func testBuildsTwoSectionCsvWithExpectedHeaders() {
        let csv = SpecialsExport.buildExportCsv(
            recipeRow: SpecialsExport.RecipeRow(
                slug: "pork-belly-app", displayName: "Pork Belly App",
                yieldQty: 12, yieldUnit: "portions", category: "appetizer",
                procedure: "Sear belly."),
            ingredientRows: [
                SpecialsExport.IngredientRow(ingredient: "Pork Belly", qty: "2", unit: "lb",
                                             vendorMatch: "Sysco", note: ""),
            ])
        XCTAssertTrue(csv.hasPrefix("# RECIPE\nslug,display_name,yield_qty,yield_unit,category,procedure\n"))
        XCTAssertTrue(csv.contains("pork-belly-app,Pork Belly App,12,portions,appetizer,Sear belly."))
        XCTAssertTrue(csv.contains("\n\n# INGREDIENTS\ningredient,qty,unit,vendor_match,note\n"))
        XCTAssertTrue(csv.contains("Pork Belly,2,lb,Sysco,"))
    }

    func testEscapesRfc4180() {
        let csv = SpecialsExport.buildExportCsv(
            recipeRow: SpecialsExport.RecipeRow(
                slug: "s", displayName: "A, B \"C\"", yieldQty: 1, yieldUnit: "ea",
                category: "", procedure: "line1\nline2"),
            ingredientRows: [])
        XCTAssertTrue(csv.contains("\"A, B \"\"C\"\"\""))
        XCTAssertTrue(csv.contains("\"line1\nline2\""))
    }

    func testEmptyIngredientListEndsAfterHeader() {
        let csv = SpecialsExport.buildExportCsv(
            recipeRow: SpecialsExport.RecipeRow(
                slug: "s", displayName: "X", yieldQty: 1, yieldUnit: "ea",
                category: "", procedure: ""),
            ingredientRows: [])
        XCTAssertTrue(csv.hasSuffix("\n\n# INGREDIENTS\ningredient,qty,unit,vendor_match,note\n"))
    }
}
