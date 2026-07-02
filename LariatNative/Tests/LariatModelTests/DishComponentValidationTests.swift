import XCTest
@testable import LariatModel

/// Parity with the validation the web POST route applies:
///   - `validateDishComponent` (lib/dishComponents.ts L12-49) — field rules.
///     NOTE the route path does NOT check KNOWN_UNITS / unit dimension; any
///     non-empty unit passes (the stricter dimension check lives only in the
///     CLI importer's validateDishComponentRow — deliberately not this port).
///   - route-level prep (app/api/dish-components/route.ts L57-74): dish_name
///     canonicalized via normalizeDishName ('normalized to empty' → reject),
///     over-length fields CLIPPED (80/200/24/500), never rejected.
///
/// No dedicated web test covers the route; these are authored against the
/// web code paths (documented in the A4.3 plan).
final class DishComponentValidationTests: XCTestCase {

    private func draft(
        dish: String = "Rope Burger",
        type: String? = "recipe",
        slug: String? = "bacon_jam",
        vendor: String? = nil,
        qty: Double = 0.5,
        unit: String = "cup",
        notes: String? = nil
    ) -> DishComponentDraft {
        DishComponentDraft(
            dishName: dish, componentType: type, recipeSlug: slug,
            vendorIngredient: vendor, qtyPerServing: qty, unit: unit,
            notes: notes, locationId: "default")
    }

    // ── validateDishComponent parity (reason strings verbatim) ─────────────

    func testValidDraftPasses() {
        XCTAssertNil(DishComponentValidation.validate(draft()))
    }

    func testDishNameRequired() {
        XCTAssertEqual(DishComponentValidation.validate(draft(dish: "")), "dish_name is required")
        XCTAssertEqual(DishComponentValidation.validate(draft(dish: "   ")), "dish_name is required")
    }

    func testComponentTypeMustBeKnown() {
        XCTAssertEqual(
            DishComponentValidation.validate(draft(type: "garnish")),
            "component_type must be \"recipe\" or \"vendor_item\"")
    }

    // Web: `input.component_type ?? 'recipe'` — nil defaults to recipe.
    func testNilComponentTypeDefaultsToRecipe() {
        XCTAssertNil(DishComponentValidation.validate(draft(type: nil)))
        XCTAssertEqual(
            DishComponentValidation.validate(draft(type: nil, slug: nil)),
            "recipe_slug is required for recipe components")
    }

    func testRecipeRequiresSlug() {
        XCTAssertEqual(
            DishComponentValidation.validate(draft(slug: nil)),
            "recipe_slug is required for recipe components")
        XCTAssertEqual(
            DishComponentValidation.validate(draft(slug: "  ")),
            "recipe_slug is required for recipe components")
    }

    func testRecipeRejectsVendorIngredient() {
        XCTAssertEqual(
            DishComponentValidation.validate(draft(vendor: "Brioche Bun")),
            "vendor_ingredient must be empty for recipe components")
        // Web truthiness: an EMPTY vendor_ingredient string is falsy → passes.
        XCTAssertNil(DishComponentValidation.validate(draft(vendor: "")))
    }

    func testVendorItemRequiresIngredient() {
        XCTAssertEqual(
            DishComponentValidation.validate(draft(type: "vendor_item", slug: nil, vendor: nil)),
            "vendor_ingredient is required for vendor_item components")
    }

    func testVendorItemRejectsSlug() {
        XCTAssertEqual(
            DishComponentValidation.validate(draft(type: "vendor_item", slug: "bacon_jam", vendor: "Bun")),
            "recipe_slug must be empty for vendor_item components")
        // Empty slug string is falsy → passes.
        XCTAssertNil(DishComponentValidation.validate(draft(type: "vendor_item", slug: "", vendor: "Bun")))
    }

    func testQtyMustBePositiveFinite() {
        let reason = "qty_per_serving must be a positive number"
        XCTAssertEqual(DishComponentValidation.validate(draft(qty: 0)), reason)
        XCTAssertEqual(DishComponentValidation.validate(draft(qty: -1)), reason)
        XCTAssertEqual(DishComponentValidation.validate(draft(qty: .nan)), reason)
        XCTAssertEqual(DishComponentValidation.validate(draft(qty: .infinity)), reason)
    }

    func testUnitRequired() {
        XCTAssertEqual(DishComponentValidation.validate(draft(unit: "")), "unit is required")
        XCTAssertEqual(DishComponentValidation.validate(draft(unit: "  ")), "unit is required")
    }

    // Route path accepts ANY non-empty unit (no KNOWN_UNITS gate).
    func testUnknownUnitPassesRouteValidation() {
        XCTAssertNil(DishComponentValidation.validate(draft(unit: "smidgen")))
    }

    // ── route-level prepare: normalize + clip ───────────────────────────────

    func testPrepareNormalizesDishName() throws {
        let row = try DishComponentValidation.prepare(draft(dish: "  THE Rope  Burger! "))
        XCTAssertEqual(row.dishName, "the rope burger")
    }

    func testPrepareRejectsNameThatNormalizesToEmpty() {
        XCTAssertThrowsError(try DishComponentValidation.prepare(draft(dish: "!!!"))) {
            XCTAssertEqual($0 as? DishComponentWriteError, .normalizedEmpty)
        }
    }

    func testPrepareThrowsValidationBeforeAnything() {
        XCTAssertThrowsError(try DishComponentValidation.prepare(draft(qty: 0))) {
            XCTAssertEqual($0 as? DishComponentWriteError,
                           .validation(reason: "qty_per_serving must be a positive number"))
        }
    }

    /// route.ts clip(): trim then slice — over-length CLIPPED, not rejected.
    func testPrepareClipsFieldLengths() throws {
        let longSlug = String(repeating: "s", count: 100)
        let recipeRow = try DishComponentValidation.prepare(draft(slug: longSlug))
        XCTAssertEqual(recipeRow.recipeSlug?.count, 80)

        let longVendor = String(repeating: "v", count: 250)
        let longUnit = String(repeating: "u", count: 30)
        let longNotes = String(repeating: "n", count: 600)
        let vendorRow = try DishComponentValidation.prepare(draft(
            type: "vendor_item", slug: nil, vendor: longVendor, unit: longUnit, notes: longNotes))
        XCTAssertEqual(vendorRow.vendorIngredient?.count, 200)
        XCTAssertEqual(vendorRow.unit.count, 24)
        XCTAssertEqual(vendorRow.notes?.count, 500)
    }

    /// Cross-type fields are nulled by the route (recipe → vendor_ingredient
    /// NULL; vendor_item → recipe_slug NULL), whitespace-only notes → nil.
    func testPrepareNullsCrossTypeFieldsAndEmptyNotes() throws {
        let recipeRow = try DishComponentValidation.prepare(draft(vendor: "", notes: "   "))
        XCTAssertEqual(recipeRow.componentType, "recipe")
        XCTAssertNil(recipeRow.vendorIngredient)
        XCTAssertNil(recipeRow.notes)

        let vendorRow = try DishComponentValidation.prepare(draft(
            type: "vendor_item", slug: "", vendor: " Brioche Bun ", notes: "toasted"))
        XCTAssertEqual(vendorRow.componentType, "vendor_item")
        XCTAssertNil(vendorRow.recipeSlug)
        XCTAssertEqual(vendorRow.vendorIngredient, "Brioche Bun")   // clip() trims
        XCTAssertEqual(vendorRow.notes, "toasted")
    }
}
