import XCTest
@testable import LariatModel

/// Mirror of tests/js/test-assistant-direct-answers.mjs — answer strings must
/// stay byte-identical across the twins.
final class AssistantDirectAnswersTests: XCTestCase {
    private let recipes: [AssistantRecipe] = [
        AssistantRecipe(
            slug: "green_chilli", name: "Green Chilli", station: "expo",
            yieldQty: .number(8), yieldUnit: "qt",
            ingredients: [
                .init(item: "pork butt", qty: .number(10), unit: "lb"),
                .init(item: "water", qty: .number(5), unit: "cup"),
                .init(item: "tomatillos", qty: .number(2), unit: "#10 can"),
                .init(item: "hatch chile with juice", qty: .number(2), unit: "bag"),
                .init(item: "yellow onions", qty: .number(1.75), unit: "lb"),
            ],
            allergens: ["wheat"], menuItems: ["Green Chilli (cup/bowl)"]
        ),
        AssistantRecipe(
            slug: "birria", name: "Birria", station: "grill",
            yieldQty: .number(16), yieldUnit: "qt",
            ingredients: [
                .init(item: "beef cheeks", qty: .number(20), unit: "lb"),
                .init(item: "qb seasoning", qty: .number(2), unit: "cup"),
            ],
            allergens: [], menuItems: ["Quesa Birria Tacos"], subRecipes: ["qb_seasoning"]
        ),
        AssistantRecipe(
            slug: "pico_de_gallo", name: "Pico De Gallo", station: "garde",
            yieldQty: .number(4), yieldUnit: "qt",
            ingredients: [
                .init(item: "roma tomatoes", qty: .number(10), unit: "lb"),
                .init(item: "cilantro", qty: .number(2), unit: "bunch"),
                .init(item: "white onion", qty: .number(3), unit: "each"),
            ],
            allergens: [], menuItems: ["Baja Fish Tacos"]
        ),
        AssistantRecipe(
            slug: "cornbread", name: "Jalapeño Cheddar Cornbread", station: "grill",
            yieldQty: .number(2), yieldUnit: "pan",
            ingredients: [
                .init(item: "cornmeal", qty: .number(4), unit: "cup"),
                .init(item: "jalapeños", qty: .number(6), unit: "each"),
            ],
            allergens: ["wheat", "dairy", "egg"],
            menuItems: ["Jalapeño Cheddar Cornbread", "cornbread croutons"]
        ),
    ]

    private func answer(_ q: String) -> String? {
        AssistantDirectAnswers.tryDirectRecipeAnswer(message: q, recipes: recipes)?.answer
    }

    func testWaterQuestionTheExactLiveFailure() {
        XCTAssertEqual(
            answer("how many cups of water in the green chilli"),
            "Green Chilli: water — 5 cup (whole recipe makes 8 qt).")
    }

    func testChiliChileSpellingsResolve() {
        for spelling in ["green chili", "green chile"] {
            let a = answer("how much water in the \(spelling)")
            XCTAssertNotNil(a, spelling)
            XCTAssertTrue(a?.contains("water — 5 cup") == true, spelling)
        }
    }

    func testMenuItemNameResolvesRecipeCard() {
        let a = answer("quesa birria recipe")
        XCTAssertNotNil(a)
        XCTAssertTrue(a?.hasPrefix("Birria — makes 16 qt · grill") == true)
        XCTAssertTrue(a?.contains("beef cheeks — 20 lb") == true)
        XCTAssertTrue(a?.contains("Sub-recipes: qb_seasoning") == true)
    }

    func testBareRecipeMentionReturnsCard() {
        let a = answer("green chilli")
        XCTAssertNotNil(a)
        XCTAssertTrue(a?.hasPrefix("Green Chilli — makes 8 qt · expo") == true)
        XCTAssertTrue(a?.contains("• pork butt — 10 lb") == true)
        XCTAssertTrue(a?.contains("Tags: wheat") == true)
    }

    func testDiacriticsFold() {
        let a = answer("whats in the jalapeno cheddar cornbread")
        XCTAssertNotNil(a)
        XCTAssertTrue(a?.contains("cornmeal — 4 cup") == true)
    }

    func testAbsentIngredientAnswersTruthfully() {
        let a = answer("how much cream in the green chilli")
        XCTAssertNotNil(a)
        XCTAssertTrue(a?.contains("doesn't list cream as an ingredient") == true)
        XCTAssertTrue(a?.contains("card") == true)
    }

    func testRecipeBookListsByStation() {
        let a = answer("recipe book")
        XCTAssertNotNil(a)
        XCTAssertTrue(a?.hasPrefix("4 recipes on file:") == true)
        XCTAssertTrue(a?.contains("GRILL: Birria, Jalapeño Cheddar Cornbread") == true)
        XCTAssertTrue(a?.contains("EXPO: Green Chilli") == true)
        XCTAssertTrue(a?.contains("GARDE: Pico De Gallo") == true)
        XCTAssertTrue(a?.contains("Reference board") == true)
    }

    func testAllergenIntentAlwaysFallsThrough() {
        XCTAssertNil(answer("is the green chilli gluten free"))
        XCTAssertNil(answer("is the cornbread safe for a dairy allergy"))
        XCTAssertNil(answer("what allergens are in the birria"))
    }

    func testNoConfidentMatchFallsThrough() {
        XCTAssertNil(answer("how do I fix the fryer"))
        XCTAssertNil(answer("what did we sell yesterday"))
    }

    func testOperationalQuestionFallsThrough() {
        XCTAssertNil(answer("why was birria 86d yesterday"))
    }

    func testFindRecipePrefersLongestPhrase() {
        let m = AssistantDirectAnswers.findRecipe(question: "quesa birria tacos", recipes: recipes)
        XCTAssertEqual(m?.recipe.slug, "birria")
        XCTAssertEqual(m?.matchedPhrase, "quesa birria tacos")
    }

    func testNormalizeTextFoldsKitchenSpellings() {
        XCTAssertEqual(AssistantDirectAnswers.normalizeText("Green CHILLI"), "green chili")
        XCTAssertEqual(AssistantDirectAnswers.normalizeText("hatch chile"), "hatch chili")
        XCTAssertEqual(AssistantDirectAnswers.normalizeText("Jalapeño"), "jalapeno")
    }

    func testRetrievalPhrasingFallsThrough() {
        XCTAssertNil(answer("Find that wedding cake recipe with the cherry filling."))
        XCTAssertNil(answer("search for the birria recipe notes"))
        XCTAssertNil(answer("look up green chilli prep from last week"))
    }

    func testCardIntentWithHeavyExtraContentFallsThrough() {
        XCTAssertNil(answer("birria recipe changes from the meeting yesterday about brisket"))
    }

    func testDistinctiveSingleWordFindsItsRecipeThePicoFind() {
        let bare = answer("pico")
        XCTAssertNotNil(bare)
        XCTAssertTrue(bare?.hasPrefix("Pico De Gallo — makes 4 qt · garde") == true)
        XCTAssertTrue(bare?.contains("roma tomatoes — 10 lb") == true)

        let q = answer("whats in the pico")
        XCTAssertTrue(q?.contains("cilantro — 2 bunch") == true)

        XCTAssertEqual(
            answer("how much cilantro in the pico"),
            "Pico De Gallo: cilantro — 2 bunch (whole recipe makes 4 qt).")
    }

    func testSharedTokenStaysAmbiguous() {
        XCTAssertNil(answer("tacos"))
    }
}
