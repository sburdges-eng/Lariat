// BeoAllergenSummaryComputeTests — per-BEO-event allergen summary. Parity
// CONCEPT with Studio 5's `computeMatrix` (flag, don't drop, unmatched
// items), but joined against the real, DB-backed `allergen_attestations`
// system (AllergenAttestationCompute/Repository) — Studio 5's own hardcoded
// 74-item table is explicitly NOT ported (see
// docs/beo-native-parity-audit-2026-07-21.md §5).

import XCTest
@testable import LariatModel

final class BeoAllergenSummaryComputeTests: XCTestCase {
    private let queso = AllergenRecipe(
        slug: "queso", name: "Queso",
        ingredients: [.init(item: "Milk"), .init(item: "Cheddar")],
        allergens: ["milk"])

    private let salsa = AllergenRecipe(
        slug: "salsa", name: "Blackened Tomato Salsa",
        ingredients: [.init(item: "Tomato"), .init(item: "Worcestershire")],
        allergens: ["fish", "wheat"])

    private func status(
        recipe: AllergenRecipe, status: AttestationStatus, latest: AllergenAttestationRecord? = nil
    ) -> RecipeAttestationStatus {
        RecipeAttestationStatus(
            recipeSlug: recipe.slug, name: recipe.name,
            heuristicAllergens: recipe.allergens, status: status, latest: latest)
    }

    // MARK: - Fully-matched event

    func testFullyMatchedEventReturnsOneRowPerItemWithStatus() {
        let statuses = [
            status(recipe: queso, status: .attested),
            status(recipe: salsa, status: .stale),
        ]
        let rows = BeoAllergenSummaryCompute.summarize(
            lineItemNames: ["Queso", "Blackened Tomato Salsa"],
            recipes: [queso, salsa],
            statuses: statuses)

        XCTAssertEqual(rows.count, 2)

        XCTAssertEqual(rows[0].itemName, "Queso")
        XCTAssertEqual(rows[0].recipeSlug, "queso")
        XCTAssertEqual(rows[0].displayName, "Queso")
        XCTAssertEqual(rows[0].allergens, ["milk"])
        XCTAssertEqual(rows[0].status, .attested)
        XCTAssertTrue(rows[0].matched)

        XCTAssertEqual(rows[1].itemName, "Blackened Tomato Salsa")
        XCTAssertEqual(rows[1].recipeSlug, "salsa")
        XCTAssertEqual(rows[1].allergens, ["fish", "wheat"])
        XCTAssertEqual(rows[1].status, .stale)
        XCTAssertTrue(rows[1].matched)
    }

    /// Matching is case/whitespace-insensitive and also resolves against a
    /// recipe's slug-with-spaces (`BeoPullCompute` parity), the same
    /// normalization the cascade/pull engines already use — no third
    /// matching scheme invented here.
    func testMatchingIsCaseAndWhitespaceInsensitiveAndAcceptsSlugForm() {
        let statuses = [status(recipe: queso, status: .unattested)]
        let rows = BeoAllergenSummaryCompute.summarize(
            lineItemNames: ["  queso  ", "QUESO"],
            recipes: [queso],
            statuses: statuses)
        // Both normalize to the same key — de-duped to one row.
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].recipeSlug, "queso")
    }

    // MARK: - Unmatched item — must flag, never silently drop

    func testUnmatchedItemIsFlaggedNotDropped() {
        let statuses = [status(recipe: queso, status: .attested)]
        let rows = BeoAllergenSummaryCompute.summarize(
            lineItemNames: ["Queso", "Mystery Fried Thing"],
            recipes: [queso],
            statuses: statuses)

        XCTAssertEqual(rows.count, 2, "the unmatched item must still produce a row")
        let unmatched = rows.first { $0.itemName == "Mystery Fried Thing" }
        guard let unmatched else { return XCTFail("unmatched row missing entirely") }
        XCTAssertNil(unmatched.recipeSlug)
        XCTAssertNil(unmatched.status)
        XCTAssertFalse(unmatched.matched)
        XCTAssertEqual(unmatched.allergens, [])
        XCTAssertEqual(unmatched.displayName, "Mystery Fried Thing")
    }

    /// A recipe that matched by name but has no entry in `statuses` (a
    /// caller passing a filtered/partial status list) must NOT collapse
    /// into "no recipe on file" — it falls back to an unattested row built
    /// from the recipe's own heuristic allergen list.
    func testMatchedRecipeMissingFromStatusesFallsBackToUnattestedNotUnmatched() {
        let rows = BeoAllergenSummaryCompute.summarize(
            lineItemNames: ["Queso"],
            recipes: [queso],
            statuses: [])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].recipeSlug, "queso")
        XCTAssertTrue(rows[0].matched)
        XCTAssertEqual(rows[0].status, .unattested)
        XCTAssertEqual(rows[0].allergens, ["milk"])
    }

    // MARK: - Empty event

    func testEmptyLineItemsProducesEmptyRows() {
        let rows = BeoAllergenSummaryCompute.summarize(
            lineItemNames: [], recipes: [queso, salsa], statuses: [])
        XCTAssertEqual(rows, [])
    }

    /// Blank/whitespace-only line-item names are skipped (nothing to match
    /// or flag), mirroring `BeoPullCompute.buildDemand`'s empty-key skip.
    func testBlankLineItemNameIsSkipped() {
        let rows = BeoAllergenSummaryCompute.summarize(
            lineItemNames: ["   ", ""], recipes: [queso], statuses: [])
        XCTAssertEqual(rows, [])
    }
}
