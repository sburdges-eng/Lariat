import XCTest
@testable import LariatModel

final class DepletionExceptionResolverTests: XCTestCase {
    typealias R = DepletionExceptionResolver

    // ── computeRecipeRatio (oracle: test-sales-depletion.mjs:74-108) ──
    func testRatioIdentity() {
        XCTAssertEqual(R.computeRecipeRatio(portionQty: 1, portionUnit: "cup", yieldQty: 4, yieldUnit: "cup"), 0.25)
    }
    func testRatioTspToCup() {
        let r = R.computeRecipeRatio(portionQty: 1, portionUnit: "tsp", yieldQty: 2, yieldUnit: "cup")
        XCTAssertNotNil(r)
        XCTAssertEqual(r!, 0.0104167, accuracy: 1e-4)
    }
    func testRatioCrossDimIsNil() {
        XCTAssertNil(R.computeRecipeRatio(portionQty: 1, portionUnit: "oz", yieldQty: 2, yieldUnit: "cup"))
    }
    func testRatioRejectsBadInputs() {
        XCTAssertNil(R.computeRecipeRatio(portionQty: 0, portionUnit: "tsp", yieldQty: 2, yieldUnit: "cup"))
        XCTAssertNil(R.computeRecipeRatio(portionQty: 1, portionUnit: "tsp", yieldQty: -1, yieldUnit: "cup"))
    }

    // ── firstUnresolved reason ladder ──
    func testInvalidQty() {
        let u = R.firstUnresolved(quantitySold: 0, components: [], yieldFor: { _ in nil }, bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .invalidQty)
        XCTAssertEqual(u?.detail, "quantity_sold=0")
    }
    func testNoDishComponents() {
        let u = R.firstUnresolved(quantitySold: 1, components: [], yieldFor: { _ in nil }, bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .noDishComponents)
        XCTAssertNil(u?.detail)
    }
    func testVendorItemResolvesCleanly() {   // omits from queue
        let c = DishComponentRow(componentType: "vendor_item", recipeSlug: nil,
                                 vendorIngredient: "cabbage slaw mix", qtyPerServing: 2, unit: "oz")
        XCTAssertNil(R.firstUnresolved(quantitySold: 1, components: [c], yieldFor: { _ in nil }, bomFor: { _ in [] }))
    }
    func testRecipeMissingYield() {   // test-depletion-exceptions.mjs "flags recipe_missing_yield"
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "mystery_aioli",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "tsp")
        let u = R.firstUnresolved(quantitySold: 1, components: [c], yieldFor: { _ in nil }, bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .recipeMissingYield)
        XCTAssertEqual(u?.detail, "mystery_aioli")
    }
    func testCrossDimMismatch() {   // test-sales-depletion.mjs "cross-dimension unit mismatch"
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "mystery_jus",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "oz")
        let u = R.firstUnresolved(quantitySold: 1, components: [c],
            yieldFor: { _ in RecipeYield(yieldQty: 1, yieldUnit: "cup") },
            bomFor: { _ in [BomLineRow(ingredient: "beef stock", qty: 1, unit: "cup", lossFactor: nil)] })
        XCTAssertEqual(u?.reason, .crossDimUnitMismatch)
        XCTAssertEqual(u?.detail, "1oz → cup for mystery_jus")
    }
    func testRecipeZeroBomLines() {   // salesDepletion.ts:255-259
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "empty_recipe",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "cup")
        let u = R.firstUnresolved(quantitySold: 1, components: [c],
            yieldFor: { _ in RecipeYield(yieldQty: 2, yieldUnit: "cup") },
            bomFor: { _ in [] })
        XCTAssertEqual(u?.reason, .noDishComponents)
        XCTAssertEqual(u?.detail, "recipe=empty_recipe has zero bom_lines")
    }
    func testCleanRecipeResolves() {   // aioli happy path → not an exception
        let c = DishComponentRow(componentType: "recipe", recipeSlug: "jal_chipotle_aioli",
                                 vendorIngredient: nil, qtyPerServing: 1, unit: "tsp")
        let u = R.firstUnresolved(quantitySold: 1, components: [c],
            yieldFor: { _ in RecipeYield(yieldQty: 2, yieldUnit: "cup") },
            bomFor: { _ in [BomLineRow(ingredient: "mayonnaise", qty: 1, unit: "cup", lossFactor: nil)] })
        XCTAssertNil(u)
    }
}
