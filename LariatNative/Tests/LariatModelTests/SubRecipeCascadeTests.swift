import XCTest
@testable import LariatModel

final class SubRecipeCascadeTests: XCTestCase {
    private let recipes: [RecipeCatalogEntry] = [
        RecipeCatalogEntry(
            slug: "lobster_bisque",
            name: "Lobster Bisque",
            subRecipes: [],
            ingredients: [RecipeIngredientRef(item: "lobster stock")]
        ),
        RecipeCatalogEntry(
            slug: "surf_turf",
            name: "Surf & Turf",
            subRecipes: ["lobster_bisque"],
            ingredients: []
        ),
        RecipeCatalogEntry(
            slug: "marinara",
            name: "Marinara",
            subRecipes: [],
            ingredients: [RecipeIngredientRef(item: "roma tomatoes")]
        ),
        RecipeCatalogEntry(
            slug: "pasta_plate",
            name: "Pasta Plate",
            subRecipes: ["marinara"],
            ingredients: []
        ),
    ]

    func testWalksSubRecipeParentsForExactRecipe86() {
        let cascaded = SubRecipeCascadeCompute.cascadedFromEightySix(
            itemsEightySixed: ["Lobster Bisque"],
            recipes: recipes
        )
        XCTAssertEqual(Set(cascaded.map(\.slug)), ["surf_turf"])
        XCTAssertEqual(cascaded.first?.via, "Lobster Bisque")
    }

    func testCascadesWhen86MatchesRecipeIngredient() {
        let cascaded = SubRecipeCascadeCompute.cascadedFromEightySix(
            itemsEightySixed: ["tomatoes"],
            recipes: recipes
        )
        XCTAssertEqual(Set(cascaded.map(\.slug)), ["marinara", "pasta_plate"])
    }

    func testKeepsIngredientMatchedRootsOnCascadeBoard() {
        let cascaded = SubRecipeCascadeCompute.cascadedFromEightySix(
            itemsEightySixed: ["tomatoes"],
            recipes: recipes
        )
        let marinara = cascaded.first { $0.slug == "marinara" }
        XCTAssertNotNil(marinara)
        XCTAssertEqual(marinara?.rootSlug, "marinara")
    }
}
