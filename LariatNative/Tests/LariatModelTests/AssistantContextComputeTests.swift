import XCTest
@testable import LariatModel

/// Pure-renderer parity for `lib/kitchenAssistantContext.ts` (+ the
/// citationHelpers guard cases from tests/js/test-kitchen-assistant-citations.mjs
/// and the lexical cases from tests/js/test-kitchen-semantic-search.mjs).
final class AssistantContextComputeTests: XCTestCase {
    private typealias C = AssistantContextCompute

    // ── tier sentinels + trailing boundary (context-pin oracle) ─────

    func testTrailingBoundaryLinesPerTier() {
        XCTAssertTrue(C.notInContextCook.contains("labor figures"))
        XCTAssertTrue(C.notInContextCook.contains("Toast totals"))
        XCTAssertFalse(C.notInContextManager.contains("labor figures"))
        XCTAssertFalse(C.notInContextManager.contains("Toast totals"))
    }

    func testSentinelCopy() {
        XCTAssertTrue(C.laborSentinel.contains("LABOR SUMMARY: not available at this auth tier"))
        XCTAssertTrue(C.goldStarSentinel.contains("GOLD STAR RECOGNITION: not available"))
        XCTAssertTrue(C.performanceSentinel.contains("PERFORMANCE REVIEWS: not available"))
    }

    func testTruncateContextBudget() {
        let long = String(repeating: "x", count: C.maxContextChars + 500)
        let out = C.truncateContext(long)
        XCTAssertTrue(out.hasSuffix("\n… [context truncated]\n"))
        XCTAssertLessThanOrEqual(out.count, C.maxContextChars)
        XCTAssertEqual(C.truncateContext("short"), "short")
    }

    // ── always-on renderers ─────────────────────────────────────────

    func testRenderActive86sEmptyStillEmitsHeaderAndSource() {
        let s = C.renderActive86s([])
        XCTAssertEqual(s.text, "ACTIVE 86 (unresolved, today):\n  (none)\n")
        XCTAssertEqual(s.source, AssistantContextSource(type: "eighty_six", detail: "0 active (today)"))
    }

    func testRenderActive86sRow() {
        let s = C.renderActive86s([
            C.Active86Row(item: "Salmon", stationId: "grill", reason: "out", quantity: "0"),
        ])
        XCTAssertTrue(s.text.contains("  - Salmon @ grill | out | qty 0\n"))
        XCTAssertEqual(s.source?.detail, "1 active (today)")
    }

    func testRenderInventoryUpdates() {
        let s = C.renderInventoryUpdates([
            C.InventoryUpdateRow(item: "cilantro", direction: "out", delta: "3 bunch", stationId: nil, note: nil),
        ])
        XCTAssertTrue(s.text.contains("  - cilantro | out · 3 bunch\n"))
    }

    func testRenderLineCheckProgressCountsPassFailNa() {
        let s = C.renderLineCheckProgress([
            C.LineCheckStationInput(
                stationId: "grill", stationName: "Grill",
                template: ["a", "b", "c"],
                entries: [
                    C.LineCheckEntryStatus(item: "a", status: "pass"),
                    C.LineCheckEntryStatus(item: "b", status: "fail"),
                ]
            ),
        ])
        XCTAssertTrue(s.text.contains("  - Grill (grill): 2/3 items recorded, 1 fail\n"))
        XCTAssertEqual(s.source?.detail, "1 station(s) with templates")
    }

    func testRenderStaffRosterFiltersInactive() {
        let s = C.renderStaffRoster([
            StaffMember(id: "c1", first: "Alex", last: "Ruiz", role: nil, active: true, jobTitle: nil),
            StaffMember(id: "c2", first: "Gone", last: "Person", role: nil, active: false, jobTitle: nil),
        ])
        XCTAssertTrue(s.text.contains("  - Alex Ruiz (ID: c1)\n"))
        XCTAssertFalse(s.text.contains("Gone"))
        XCTAssertEqual(s.source?.detail, "1 active staff")
    }

    func testRenderSalesVelocityRoundsAndSkipsZero() {
        let s = C.renderSalesVelocity([
            C.SalesVelocityRow(itemName: "Burger", qty: 39.6),
            C.SalesVelocityRow(itemName: "Nothing", qty: 0),
        ])
        XCTAssertTrue(s.text.contains("  - Burger: 40 units sold\n"))
        XCTAssertFalse(s.text.contains("Nothing"))
    }

    // ── recipe selection + snippet ──────────────────────────────────

    private var recipes: [AssistantRecipe] {
        [
            AssistantRecipe(
                slug: "almond-wedding-cake", name: "Almond Celebration Cake", station: "Pastry",
                yieldQty: .number(1), yieldUnit: "tiered cake",
                ingredients: [
                    .init(item: "almond sponge", qty: .number(3), unit: "layers"),
                    .init(item: "sour cherry filling", qty: .number(2), unit: "qt"),
                ],
                allergens: ["egg", "milk", "tree nut", "wheat"],
                menuItems: ["wedding cake"], subRecipes: ["cherry-filling"]
            ),
            AssistantRecipe(
                slug: "cherry-filling", name: "Sour Cherry Filling", station: "Pastry",
                ingredients: [.init(item: "sour cherries", qty: .number(4), unit: "qt")],
                allergens: []
            ),
            AssistantRecipe(
                slug: "citrus-salmon", name: "Citrus Salmon", station: "Grill",
                ingredients: [.init(item: "salmon fillet", qty: .number(6), unit: "oz")],
                allergens: ["fish"], menuItems: ["salmon entree"]
            ),
        ]
    }

    func testPickRelevantRecipesScoresNameAndMenuMatches() {
        let picked = C.pickRelevantRecipes(
            question: "how do we build the wedding cake?",
            recipes: recipes, max: 5,
            menuMatchedSlugs: ["almond-wedding-cake"]
        )
        XCTAssertEqual(picked.first?.slug, "almond-wedding-cake")
    }

    func testCollectSubRecipesResolvesReferencedSlugs() {
        let picked = [recipes[0]]
        let subs = C.collectSubRecipes(picked: picked, recipes: recipes)
        XCTAssertEqual(subs.map(\.slug), ["cherry-filling"])
    }

    func testFormatRecipeSnippetShape() {
        let matrix: AssistantAllergenMatrix = [
            "almond-wedding-cake": [AssistantAllergenEntry(ingredient: "almond sponge", big9: ["tree nut"])],
        ]
        let out = C.formatRecipeSnippet(recipes[0], allergenMatrix: matrix, isSub: false)
        XCTAssertTrue(out.hasPrefix("<RECIPE name=\"Almond Celebration Cake\" slug=\"almond-wedding-cake\">\n"))
        XCTAssertTrue(out.contains("  STATION: Pastry\n"))
        XCTAssertTrue(out.contains("  YIELD: 1 tiered cake\n"))
        XCTAssertTrue(out.contains("  MENU ITEMS: wedding cake\n"))
        XCTAssertTrue(out.contains("  SUB-RECIPES: cherry-filling\n"))
        XCTAssertTrue(out.contains("  ALLERGENS (TAGS): egg, milk, tree nut, wheat\n"))
        XCTAssertTrue(out.contains("  INGREDIENTS: almond sponge 3 layers; sour cherry filling 2 qt\n"))
        XCTAssertTrue(out.contains("  ALLERGEN DETAIL (INGREDIENT-LEVEL):\n    almond sponge -> tree nut\n"))
        XCTAssertTrue(out.hasSuffix("</RECIPE>\n\n"))
    }

    func testRenderRecipeBlockEmptyWarnsAgainstInvention() {
        let out = C.renderRecipeBlock(picked: [], subRecipes: [], allergenMatrix: [:])
        XCTAssertTrue(out.contains("(no recipe matched — do not invent recipe or allergen facts)"))
    }

    // ── USDA citation helpers (citations-test oracle) ───────────────

    func testUsdaNutrientPriorityPinned() {
        XCTAssertEqual(C.usdaNutrientPriority, [
            "Energy", "Protein", "Carbohydrate", "Total lipid (fat)", "Sodium, Na", "Sugars, total",
        ])
    }

    func testFormatUnitPinned() {
        XCTAssertEqual(C.formatUnit("KCAL"), "kcal")
        XCTAssertEqual(C.formatUnit("G"), "g")
        XCTAssertEqual(C.formatUnit("MG"), "mg")
        XCTAssertEqual(C.formatUnit("UG"), "µg")
        XCTAssertEqual(C.formatUnit("IU"), "IU")
        XCTAssertEqual(C.formatUnit("kJ"), "kJ")
        XCTAssertEqual(C.formatUnit("MG_ATE"), "mg α-TE")
        XCTAssertEqual(C.formatUnit("SP_GR"), "sp.gr.")
        XCTAssertEqual(C.formatUnit("WEIRD"), "WEIRD")
        XCTAssertEqual(C.formatUnit(nil), "")
    }

    func testPriorityDisplayPinned() {
        XCTAssertEqual(C.usdaPriorityDisplay, [
            "Total lipid (fat)": "Fat", "Sodium, Na": "Sodium", "Sugars, total": "Sugars",
        ])
    }

    func testFormatPriorityNutrientsRendersCompactLine() {
        let line = C.formatPriorityNutrients([
            C.UsdaNutrientInput(nutrientName: "Energy", amount: 109, unitName: "KCAL"),
            C.UsdaNutrientInput(nutrientName: "Protein", amount: 20.4, unitName: "G"),
            C.UsdaNutrientInput(nutrientName: "Sodium, Na", amount: 59, unitName: "MG"),
            C.UsdaNutrientInput(nutrientName: "Vitamin D", amount: 11, unitName: "UG"),
        ])
        XCTAssertEqual(line, "Energy 109 kcal · Protein 20.4 g · Sodium 59 mg")
    }

    func testRenderUsdaIngredientsDedupesByFdcId() {
        let hit = C.UsdaIngredientHit(
            fdcId: 12345, description: "Salmon, Atlantic, raw", category: "Finfish",
            meta: "sr_legacy", nutrients: [C.UsdaNutrientInput(nutrientName: "Energy", amount: 208, unitName: "KCAL")]
        )
        let s = C.renderUsdaIngredients([hit, hit])
        XCTAssertEqual(s.source?.detail, "1 food(s)")
        XCTAssertTrue(s.text.contains("[fdc_id 12345] Salmon, Atlantic, raw (Finfish · sr_legacy)"))
        XCTAssertTrue(s.text.contains("Energy 208 kcal"))
    }

    // ── FDA food code ───────────────────────────────────────────────

    func testFdaDedupeBySectionIdKeepsFirstAndCapsAtThree() {
        let hits = [
            C.FdaFoodCodeHit(sectionId: "3-501.14", title: "Cooling", whereLabel: "Chapter 3", body: "b1"),
            C.FdaFoodCodeHit(sectionId: "3-501.14", title: "Cooling (Annex)", whereLabel: "Annex 3", body: "b2"),
            C.FdaFoodCodeHit(sectionId: "3-401.11", title: "Cooking", whereLabel: "Chapter 3", body: "b3"),
            C.FdaFoodCodeHit(sectionId: "4-501.11", title: "Equipment", whereLabel: "Chapter 4", body: "b4"),
            C.FdaFoodCodeHit(sectionId: "5-101.11", title: "Water", whereLabel: "Chapter 5", body: "b5"),
        ]
        let unique = C.dedupeFdaHits(hits)
        XCTAssertEqual(unique.map(\.sectionId), ["3-501.14", "3-401.11", "4-501.11"])
        XCTAssertEqual(unique.first?.title, "Cooling", "first (best-ranked) wins the dedupe")
    }

    func testTruncateSafeAvoidsSplittingSurrogatePair() {
        XCTAssertEqual(C.truncateSafe("hello", 10), "hello")
        XCTAssertEqual(C.truncateSafe("hello world", 5), "hello…")
        // "a😀" — 😀 is a surrogate pair; cutting at 2 UTF-16 units would leave
        // a lone high surrogate. truncateSafe drops it.
        XCTAssertEqual(C.truncateSafe("a😀b", 2), "a…")
    }

    // ── equipment specs filter derivation ───────────────────────────

    func testEquipmentSpecFilters() {
        let f = C.equipmentSpecFilters("what model is the fryer")
        XCTAssertEqual(f.catLikes, ["fryers"])
        XCTAssertEqual(f.nameLikes, ["fryer"])
        XCTAssertTrue(C.equipmentSpecFilters("is anything broken?").isEmpty,
                      "generic status words don't trip the spec block")
    }

    // ── daily sales trend formatting ────────────────────────────────

    func testRenderDailySalesTrendYoY() {
        let s = C.renderDailySalesTrend([
            C.DailySalesTrendRow(
                shiftDate: "2026-06-15", netSales: 4200, orders: 180, guests: 230,
                yoyNetSales: 3800, yoyOrders: 160, yoyGuests: 198
            ),
        ])
        XCTAssertTrue(s.text.contains("  - 2026-06-15: $4,200.00 / 180 orders / 230 guests (YoY: $3,800.00 / 160 / 198, +10.5% YoY)\n"))
        XCTAssertEqual(s.source?.detail, "1 day(s), 1 with YoY")
    }

    // ── keyword gates ───────────────────────────────────────────────

    func testKeywordGates() {
        XCTAssertTrue(C.matchesKeywords("show me labor cost and overtime hours", C.laborKeywords))
        XCTAssertFalse(C.matchesKeywords("what sandwiches do we sell?", C.laborKeywords))
        XCTAssertTrue(C.matchesKeywords("who got a gold star recently?", C.goldStarKeywords))
        XCTAssertTrue(C.matchesKeywords("do we have a recent performance review for the line?", C.performanceKeywords))
        XCTAssertTrue(C.matchesKeywords("what's the cooling temp for chicken", C.foodSafetyKeywords))
        XCTAssertTrue(C.matchesKeywords("how much protein in salmon", C.ingredientKeywords))
        XCTAssertTrue(C.matchesKeywords("underage id check policy", C.complianceKeywords))
    }

    // ── semantic search compute (kitchen-semantic-search oracle) ────

    func testSemanticRankFindsRecipeAndPenalizesUnrelated() {
        let rows = [
            KitchenSemanticSearchCompute.CorpusRow(
                type: .recipe, title: "Almond Celebration Cake",
                detail: "slug almond-wedding-cake | station Pastry | menu wedding cake",
                text: "Almond Celebration Cake\nalmond-wedding-cake\nPastry\nwedding cake\nalmond sponge 3 layers sour cherry filling 2 qt",
                id: "recipe:almond-wedding-cake", source: "local recipe book"
            ),
            KitchenSemanticSearchCompute.CorpusRow(
                type: .recipe, title: "Citrus Salmon",
                detail: "slug citrus-salmon | station Grill",
                text: "Citrus Salmon\ncitrus-salmon\nGrill\nsalmon fillet 6 oz",
                id: "recipe:citrus-salmon", source: "local recipe book"
            ),
        ]
        let hits = KitchenSemanticSearchCompute.rankCorpus(
            query: "that wedding cake recipe with the cherry filling", rows: rows, limit: 8
        )
        XCTAssertEqual(hits.first?.id, "recipe:almond-wedding-cake")
        // Web parity: every recipe gets +1 when the query says "recipe", so the
        // salmon row IS present — just far below the real match.
        if let salmon = hits.first(where: { $0.id == "recipe:citrus-salmon" }),
           let cake = hits.first(where: { $0.id == "recipe:almond-wedding-cake" }) {
            XCTAssertGreaterThan(cake.score, salmon.score)
        }
    }

    func testSemanticShortShorthandMatchesViaNormalizedQuery() {
        // "GF" tokenizes to nothing (length ≤ 2) but normalizes to "gf".
        let rows = [
            KitchenSemanticSearchCompute.CorpusRow(
                type: .beoLineItem, title: "Berry cobbler",
                detail: "2026-06-22 | BEO 9: Lopez Gluten-Free Rehearsal | Dessert | 48 qty",
                text: "Berry cobbler\nDessert\n48\nGF cobbler needs a separate tray for the celiac guest.\nCeliac dessert",
                id: "beo_line_item:9", source: "BEO line item"
            ),
        ]
        let hits = KitchenSemanticSearchCompute.rankCorpus(query: "GF", rows: rows, limit: 4)
        XCTAssertEqual(hits.first?.title, "Berry cobbler")
        XCTAssertTrue(hits.first?.excerpt.lowercased().contains("gf cobbler") == true)
    }

    func testSemanticExcerptAnchorsPastPunctuation() {
        let noise = String(repeating: "!", count: 260)
        let rows = [
            KitchenSemanticSearchCompute.CorpusRow(
                type: .beoLineItem, title: "Dessert service note",
                detail: "detail",
                text: "\(noise) separate tray for gluten-free cake near expo.",
                id: "beo_line_item:10", source: "BEO line item"
            ),
        ]
        let hits = KitchenSemanticSearchCompute.rankCorpus(query: "separate tray", rows: rows, limit: 4)
        XCTAssertNotNil(hits.first)
        XCTAssertTrue(hits.first?.excerpt.lowercased().contains("separate tray") == true)
    }

    func testSemanticFormatForPromptShapes() {
        let empty = KitchenSemanticSearchCompute.SearchResult(query: "", hits: [])
        XCTAssertEqual(KitchenSemanticSearchCompute.formatForPrompt(empty), "No semantic search matches for \"blank query\".")

        let result = KitchenSemanticSearchCompute.SearchResult(query: "cake", hits: [
            KitchenSemanticSearchCompute.Hit(
                type: .recipe, score: 5, title: "Almond Celebration Cake",
                detail: "slug almond-wedding-cake", excerpt: "almond sponge",
                id: "recipe:almond-wedding-cake", source: "local recipe book"
            ),
        ])
        let rendered = KitchenSemanticSearchCompute.formatForPrompt(result)
        XCTAssertTrue(rendered.hasPrefix("Semantic search for \"cake\" - 1 hit(s):"))
        XCTAssertTrue(rendered.contains("1. [Recipe (local recipe book)] Almond Celebration Cake - slug almond-wedding-cake - almond sponge"))
    }

    // ── compliance compute ──────────────────────────────────────────

    func testComplianceMatchExpressionStripsStopWordsAndPunctuation() {
        XCTAssertEqual(
            ComplianceSearchCompute.matchExpression("How do we handle a fake ID?"),
            "handle* fake* id*"
                .split(separator: " ").joined(separator: " OR ")
        )
        XCTAssertNil(ComplianceSearchCompute.matchExpression("   "))
        XCTAssertNil(ComplianceSearchCompute.matchExpression("do the a an"))
    }

    func testRenderComplianceBlockShape() {
        let hit = ComplianceSearchCompute.SearchHit(
            id: "liquor-001", verificationStatus: "verified",
            rule: ComplianceSearchCompute.RulePayload(
                topic: "ID checks", domain: "liquor_law",
                plainLanguageSummary: "Check ID for anyone who looks under 50.",
                requiredActions: ["Check ID", "Log refusals", "Escalate fakes", "Fourth action dropped"],
                prohibitedActions: ["Serving minors"],
                escalation: .init(managerRequired: true, policeRequired: nil, emsRequired: nil),
                source: .init(title: "CO Liquor Code")
            )
        )
        let s = ComplianceSearchCompute.renderCompliance([hit])
        XCTAssertTrue(s.text.contains("COLORADO COMPLIANCE (verify before acting):"))
        XCTAssertTrue(s.text.contains("  - [liquor-001] ID checks (liquor_law)\n"))
        XCTAssertTrue(s.text.contains("    required: Check ID; Log refusals; Escalate fakes\n"), "capped at 3")
        XCTAssertTrue(s.text.contains("    escalation: manager required\n"))
        XCTAssertTrue(s.text.contains("    verification: verified\n"))
        XCTAssertEqual(s.source, AssistantContextSource(type: "compliance", detail: "1 CO compliance rule(s)"))
    }

    // ── prompts ─────────────────────────────────────────────────────

    func testGroundedSystemCarriesHaccpNumbersVerbatim() {
        let sys = AssistantPrompts.groundedSystem
        XCTAssertTrue(sys.contains("Poultry: >= 165 F for 15 sec"))
        XCTAssertTrue(sys.contains("Cooling: 135 -> 70 F within 2 hr, then 70 -> 41 F within 4 hr (total 6 hr max, per FDA §3-501.14)"))
        XCTAssertTrue(sys.contains("NEVER say a dish is \"safe,\" \"free of,\" or \"does not contain\" any allergen"))
    }

    func testUserContentAssemblyCommandVsQuestion() {
        let cmd = AssistantPrompts.userContent(
            contextText: "CTX", conversationHistory: "", message: "86 the salmon",
            language: nil, isCommand: true
        )
        XCTAssertTrue(cmd.hasPrefix("CONTEXT (authoritative — only use these facts for operational claims):\n\nCTX\n"))
        XCTAssertTrue(cmd.contains("SEMANTIC SEARCH ACTION:"))
        XCTAssertTrue(cmd.contains("---\nCOOK MESSAGE:\n86 the salmon"))
        XCTAssertTrue(cmd.contains("ACTION ENGINE DIRECTIVE:"))
        XCTAssertFalse(cmd.contains("ANSWER FORMAT:"))

        let q = AssistantPrompts.userContent(
            contextText: "CTX", conversationHistory: "PRIOR TURNS", message: "what's 86?",
            language: "Spanish", isCommand: false
        )
        XCTAssertTrue(q.contains("\n---\nPRIOR TURNS\n"))
        XCTAssertTrue(q.contains("TRANSLATION DIRECTIVE: You MUST answer the cook entirely in Spanish."))
        XCTAssertTrue(q.contains("ANSWER FORMAT:"))
        XCTAssertFalse(q.contains("ACTION ENGINE DIRECTIVE:"))
    }
}
