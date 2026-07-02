import XCTest
@testable import LariatModel

/// Value-parity tests for the pure parts of `lib/beoPrepHistory.ts`
/// (`clampLimit`, `parseAmountQty`, `median`, the bidirectional recipe-name
/// match, and the two item-cleaning passes). The web module has no dedicated
/// unit tests for these helpers — cases are authored against the web code
/// (values taken from its doc comments) and pinned here.
final class BeoPrepHistoryComputeTests: XCTestCase {

    // ── clampLimit (default 5, max 25, non-positive/nil → default) ──────

    func testClampLimit() {
        XCTAssertEqual(BeoPrepHistoryCompute.clampLimit(nil), 5)
        XCTAssertEqual(BeoPrepHistoryCompute.clampLimit(0), 5)
        XCTAssertEqual(BeoPrepHistoryCompute.clampLimit(-3), 5)
        XCTAssertEqual(BeoPrepHistoryCompute.clampLimit(2), 2)
        XCTAssertEqual(BeoPrepHistoryCompute.clampLimit(25), 25)
        XCTAssertEqual(BeoPrepHistoryCompute.clampLimit(999), 25)
    }

    // ── parseAmountQty ───────────────────────────────────────────────────

    func testParsesPlainNumbers() {
        XCTAssertEqual(BeoPrepHistoryCompute.parseAmountQty("30"), 30)
        XCTAssertEqual(BeoPrepHistoryCompute.parseAmountQty("2.5"), 2.5)
    }

    func testStripsTrailingUnitToken() {
        XCTAssertEqual(BeoPrepHistoryCompute.parseAmountQty("30 ea"), 30)
        XCTAssertEqual(BeoPrepHistoryCompute.parseAmountQty("50 lb"), 50)
    }

    func testAcceptsThousandsSeparatorCommas() {
        XCTAssertEqual(BeoPrepHistoryCompute.parseAmountQty("1,000"), 1000)
        XCTAssertEqual(BeoPrepHistoryCompute.parseAmountQty("2,500 ea"), 2500)
    }

    func testRejectsDescriptiveValues() {
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty("as needed"))
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty("TBD"))
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty(""))
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty(nil))
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty("   "))
    }

    func testRejectsNonPositive() {
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty("0"))
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty("-30"))
        XCTAssertNil(BeoPrepHistoryCompute.parseAmountQty("-2,500"))
    }

    // ── median (caller passes sorted array — trust-the-caller) ───────────

    func testMedian() {
        XCTAssertEqual(BeoPrepHistoryCompute.median(sorted: []), 0)
        XCTAssertEqual(BeoPrepHistoryCompute.median(sorted: [40]), 40)
        XCTAssertEqual(BeoPrepHistoryCompute.median(sorted: [30, 40, 50]), 40)
        XCTAssertEqual(BeoPrepHistoryCompute.median(sorted: [30, 40, 50, 60]), 45)
    }

    // ── bidirectional recipe-name substring match ────────────────────────

    func testItemContainsRecipeName() {
        // recipe "Tacos" → item "Carnitas Tacos Buffet"
        XCTAssertTrue(BeoPrepHistoryCompute.recipeItemMatches(
            recipeNameLower: "tacos", itemLower: "carnitas tacos buffet"))
    }

    func testRecipeNameContainsItem() {
        // recipe "Aji Verde" → item "Aji"
        XCTAssertTrue(BeoPrepHistoryCompute.recipeItemMatches(
            recipeNameLower: "aji verde", itemLower: "aji"))
    }

    func testShortItemsDoNotReverseMatch() {
        // A 2-char BEO item would substring-match nearly every recipe → noise.
        XCTAssertFalse(BeoPrepHistoryCompute.recipeItemMatches(
            recipeNameLower: "salsa verde", itemLower: "sa"))
    }

    func testNoMatch() {
        XCTAssertFalse(BeoPrepHistoryCompute.recipeItemMatches(
            recipeNameLower: "brisket", itemLower: "cheesecake"))
    }

    // ── cleaning passes ──────────────────────────────────────────────────

    func testCleanedItemsTrimsDropsEmptiesAndDedupesExact() {
        // getItemPrepHistory: case-SENSITIVE dedupe of the cleaned list.
        XCTAssertEqual(
            BeoPrepHistoryCompute.cleanedItems(["Mac Balls", "mac balls", "", "  ", "Mac Balls"]),
            ["Mac Balls", "mac balls"]
        )
    }

    func testKeyedItemsDedupeByLowercasedKeyPreservingFirstCasing() {
        // getPrepMedianForItems: lowercased-key dedupe, keeps the exact-cased input.
        let out = BeoPrepHistoryCompute.keyedItems(["Mac Balls", "mac balls", " Queso "])
        XCTAssertEqual(out.map(\.key), ["mac balls", "queso"])
        XCTAssertEqual(out.map(\.item), ["Mac Balls", "Queso"])
    }
}
