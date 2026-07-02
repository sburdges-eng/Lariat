import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity port of tests/js/test-kitchen-assistant-context-pin.mjs (GH #247)
/// plus coordinator ordering/source assertions, against the real web schema.
final class AssistantContextRepositoryTests: XCTestCase {
    private let LOC = "default"

    private func makeRepo(
        staff: [StaffMember] = [],
        recipes: [AssistantRecipe] = []
    ) throws -> (AssistantContextRepository, LariatWriteDatabase, String) {
        let path = try seedAssistantDatabase()
        let readDB = try LariatDatabase(path: path)
        let writeDB = try LariatWriteDatabase(path: path)
        let repo = AssistantContextRepository(
            readDB: readDB,
            caches: AssistantContextRepository.Caches(
                recipes: { recipes }, menu: { [] }, allergenMatrix: { [:] },
                staff: { staff }, foodSafety: { AssistantFoodSafetyData(ccps: []) },
                vendorSummary: { nil }, laborSummary: { nil },
                stations: { StationCatalog(stations: [], lineCheckTemplates: [:], recipes: []) }
            )
        )
        return (repo, writeDB, path)
    }

    private func seedSales(_ writeDB: LariatWriteDatabase) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO sales_lines (location_id, period_label, item_name, quantity_sold, net_sales, source)
                  VALUES (?, date('now'), 'Smoked Brisket Sandwich', 28, 420, 'test')
                  """,
                arguments: [self.LOC]
            )
            try db.execute(
                sql: """
                  INSERT INTO toast_sales_daily (location_id, shift_date, net_sales, orders, guests, comparison_group)
                  VALUES (?, date('now'), 12500, 320, 410, 1)
                  """,
                arguments: [self.LOC]
            )
        }
    }

    private func seedRecognition(_ writeDB: LariatWriteDatabase) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO gold_stars (location_id, cook_name, reason, stars) VALUES (?, 'A. Cook', 'best in show', 3)",
                arguments: [self.LOC]
            )
        }
    }

    // ── #247 (a): sales blocks gated on hasPin ──────────────────────

    func testCookTierOmitsSalesVelocityAndDailyTrend() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedSales(writeDB)
        let ctx = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "how is the sandwich selling today?", hasPin: false
        )
        XCTAssertFalse(ctx.contextText.contains("SALES VELOCITY"), "cook-tier must not see sales aggregates")
        XCTAssertFalse(ctx.contextText.contains("DAILY SALES TREND"), "cook-tier must not see Toast totals")
    }

    func testManagerTierRestoresSalesVelocity() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedSales(writeDB)
        let ctx = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "how is the sandwich selling today?", hasPin: true
        )
        XCTAssertTrue(ctx.contextText.contains("SALES VELOCITY"))
        XCTAssertTrue(ctx.contextText.contains("Smoked Brisket Sandwich: 28 units sold"))
        XCTAssertTrue(ctx.contextText.contains("DAILY SALES TREND"))
    }

    // ── #247 (b): LABOR_KEYWORDS gated on hasPin ────────────────────

    func testCookTierLaborSentinelOnLaborQuestions() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let ctx = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "show me labor cost and overtime hours", hasPin: false
        )
        XCTAssertFalse(ctx.contextText.contains("LABOR SUMMARY (from 7shifts export):"),
                       "cook-tier MUST NOT see the 7shifts block")
        XCTAssertTrue(ctx.contextText.contains("LABOR SUMMARY: not available at this auth tier"))
    }

    func testNonLaborQuestionHasNoLaborSentinel() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let ctx = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "what sandwiches do we sell?", hasPin: false
        )
        XCTAssertFalse(ctx.contextText.contains("LABOR SUMMARY"))
    }

    // ── #247 (c): gold-star / performance gating ────────────────────

    func testCookTierReplacesRecognitionAndReviewsWithSentinels() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedRecognition(writeDB)

        let gold = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "who got a gold star recently?", hasPin: false
        )
        XCTAssertFalse(gold.contextText.contains("A. Cook"), "cook-tier must not see the recognition row")
        XCTAssertTrue(gold.contextText.contains("GOLD STAR RECOGNITION: not available"))

        let perf = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "do we have a recent performance review for the line?", hasPin: false
        )
        XCTAssertTrue(perf.contextText.contains("PERFORMANCE REVIEWS: not available"))
    }

    func testManagerTierSurfacesGoldStarRow() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedRecognition(writeDB)
        let ctx = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "who got a gold star recently?", hasPin: true
        )
        XCTAssertTrue(ctx.contextText.contains("A. Cook"))
    }

    // ── #247 (d): trailing boundary reconciliation ──────────────────

    func testCookTierBoundaryNamesLaborAndToastAsUnavailable() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let ctx = try repo.buildGroundedContext(locationId: LOC, userQuestion: "hello", hasPin: false)
        let trail = ctx.contextText.range(of: "NOT IN THIS CONTEXT:").map {
            String(ctx.contextText[$0.lowerBound...].prefix(200))
        } ?? ""
        XCTAssertTrue(trail.contains("labor figures"))
        XCTAssertTrue(trail.contains("Toast totals"))
    }

    func testManagerTierBoundaryOmitsLaborAndToast() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let ctx = try repo.buildGroundedContext(locationId: LOC, userQuestion: "hello", hasPin: true)
        let trail = ctx.contextText.range(of: "NOT IN THIS CONTEXT:").map {
            String(ctx.contextText[$0.lowerBound...].prefix(200))
        } ?? ""
        XCTAssertFalse(trail.contains("labor figures"))
        XCTAssertFalse(trail.contains("Toast totals"))
    }

    // ── coordinator shape ───────────────────────────────────────────

    func testAlwaysOnSectionsAndSourceOrder() throws {
        let (repo, writeDB, path) = try makeRepo(
            staff: [StaffMember(id: "c1", first: "Alex", last: "Ruiz", role: nil, active: true, jobTitle: nil)]
        )
        defer { cleanupAssistantDatabase(path) }
        _ = try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO eighty_six (location_id, item, shift_date) VALUES (?, 'Lobster Bisque', date('now'))",
                arguments: [self.LOC]
            )
            try db.execute(
                sql: "INSERT INTO inventory_updates (location_id, item, shift_date, delta, direction) VALUES (?, 'cilantro', date('now'), '3 bunch', 'out')",
                arguments: [self.LOC]
            )
        }
        let ctx = try repo.buildGroundedContext(locationId: LOC, userQuestion: "anything 86?", hasPin: false)

        XCTAssertTrue(ctx.contextText.hasPrefix("DATE: "))
        XCTAssertTrue(ctx.contextText.contains("LOCATION_ID: default"))
        XCTAssertTrue(ctx.contextText.contains("ACTIVE 86 (unresolved, today):\n  - Lobster Bisque\n"))
        XCTAssertTrue(ctx.contextText.contains("RECENT INVENTORY UPDATES (today, newest first):\n  - cilantro | out · 3 bunch\n"))
        XCTAssertTrue(ctx.contextText.contains("ACTIVE STAFF ROSTER"))
        XCTAssertTrue(ctx.contextText.contains("STATION SIGN-OFFS (today):\n  (none)\n"))
        XCTAssertTrue(ctx.contextText.contains("RECIPES (Isolated in XML tags"))

        // Source-push order: eighty_six, inventory, signoffs, line_checks,
        // then staff_roster (tests on the web assert this order).
        let types = ctx.sources.map(\.type)
        XCTAssertEqual(Array(types.prefix(5)), ["eighty_six", "inventory", "signoffs", "line_checks", "staff_roster"])
        XCTAssertEqual(ctx.sources.first?.detail, "1 active (today)")
    }

    func testLocationScopingKeepsForeignRowsOut() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try writeDB.write { db in
            try db.execute(
                sql: "INSERT INTO eighty_six (location_id, item, shift_date) VALUES ('site-b', 'Foreign Item', date('now'))"
            )
        }
        let ctx = try repo.buildGroundedContext(locationId: LOC, userQuestion: "anything 86?", hasPin: false)
        XCTAssertFalse(ctx.contextText.contains("Foreign Item"))
        XCTAssertTrue(ctx.contextText.contains("ACTIVE 86 (unresolved, today):\n  (none)\n"))
    }

    func testRecipeSelectionRidesIntoContextAndSources() throws {
        let recipes = [
            AssistantRecipe(
                slug: "queso", name: "Queso Blanco", station: "Fry",
                ingredients: [.init(item: "white american cheese", qty: .number(5), unit: "lb")],
                allergens: ["milk"], menuItems: ["chips and queso"]
            ),
        ]
        let (repo, _, path) = try makeRepo(recipes: recipes)
        defer { cleanupAssistantDatabase(path) }
        let ctx = try repo.buildGroundedContext(
            locationId: LOC, userQuestion: "how do we make the queso?", hasPin: false
        )
        XCTAssertTrue(ctx.contextText.contains("<RECIPE name=\"Queso Blanco\" slug=\"queso\">"))
        XCTAssertTrue(ctx.sources.contains { $0.type == "recipes" && $0.detail == "Queso Blanco" })
    }

    func testContextTruncationBudget() throws {
        // 500 order-guide-free 86 rows won't blow 12k, so force it with many
        // long active-86 reasons.
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try writeDB.write { db in
            for i in 0..<40 {
                try db.execute(
                    sql: "INSERT INTO eighty_six (location_id, item, shift_date, reason) VALUES (?, ?, date('now'), ?)",
                    arguments: [self.LOC, "Item \(i)", String(repeating: "reason ", count: 60)]
                )
            }
        }
        let ctx = try repo.buildGroundedContext(locationId: LOC, userQuestion: "anything 86?", hasPin: false)
        XCTAssertLessThanOrEqual(ctx.contextText.count, AssistantContextCompute.maxContextChars)
        XCTAssertTrue(ctx.contextText.hasSuffix("\n… [context truncated]\n"))
    }
}
