import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity port of tests/js/test-kitchen-semantic-search.mjs against the real
/// schema (the pure ranking cases live in AssistantContextComputeTests).
final class KitchenSemanticSearchRepositoryTests: XCTestCase {
    private let LOC = "default"
    private let OTHER_LOC = "other-location"

    private var recipes: [AssistantRecipe] {
        [
            AssistantRecipe(
                slug: "almond-wedding-cake", name: "Almond Celebration Cake", station: "Pastry",
                yieldQty: .number(1), yieldUnit: "tiered cake",
                ingredients: [
                    .init(item: "almond sponge", qty: .number(3), unit: "layers"),
                    .init(item: "sour cherry filling", qty: .number(2), unit: "qt"),
                    .init(item: "vanilla buttercream", qty: .number(3), unit: "qt"),
                ],
                procedure: "Split sponge, pipe buttercream dam, fill with sour cherries, stack cold.",
                allergens: ["egg", "milk", "tree nut", "wheat"],
                menuItems: ["wedding cake"]
            ),
            AssistantRecipe(
                slug: "citrus-salmon", name: "Citrus Salmon", station: "Grill",
                ingredients: [
                    .init(item: "salmon fillet", qty: .number(6), unit: "oz"),
                    .init(item: "lemon", qty: .number(1), unit: "each"),
                ],
                procedure: "Grill and glaze.",
                allergens: ["fish"],
                menuItems: ["salmon entree"]
            ),
        ]
    }

    private func makeRepo() throws -> (KitchenSemanticSearchRepository, LariatWriteDatabase, String) {
        let path = try seedAssistantDatabase()
        let writeDB = try LariatWriteDatabase(path: path)
        let readDB = try LariatDatabase(path: path)
        let localRecipes = recipes
        return (
            KitchenSemanticSearchRepository(readDB: readDB, loadRecipes: { localRecipes }),
            writeDB,
            path
        )
    }

    private func seedRows(_ writeDB: LariatWriteDatabase) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO beo_events (title, event_date, contact_name, guest_count, notes, location_id)
                  VALUES ('Parker Wedding', '2026-06-20', 'Avery Parker', 140,
                          'Dessert course uses sour cherry filling and almond cake.', ?)
                  """,
                arguments: [self.LOC]
            )
            let wedding = db.lastInsertedRowID
            try db.execute(
                sql: """
                  INSERT INTO beo_line_items (event_id, sort_order, item_name, category, quantity, unit_cost, prep_notes, group_note)
                  VALUES (?, 1, 'Tiered almond cake with cherry filling', 'Dessert', 140, 4.5,
                          'Keep filling cold until final assembly.', 'Wedding dessert')
                  """,
                arguments: [wedding]
            )
            try db.execute(
                sql: """
                  INSERT INTO beo_events (title, event_date, contact_name, guest_count, notes, location_id)
                  VALUES ('Other Venue Wedding', '2026-06-21', 'Cross Location', 80,
                          'This cherry cake belongs to another location.', ?)
                  """,
                arguments: [self.OTHER_LOC]
            )
            let other = db.lastInsertedRowID
            try db.execute(
                sql: """
                  INSERT INTO beo_line_items (event_id, sort_order, item_name, category, quantity, unit_cost, prep_notes, group_note)
                  VALUES (?, 1, 'Cross-location cherry wedding cake', 'Dessert', 80, 4.5,
                          'Should never leak into default location search.', 'Other venue')
                  """,
                arguments: [other]
            )
            // Safe audit entity — visible.
            try db.execute(
                sql: """
                  INSERT INTO audit_events (shift_date, location_id, actor_source, entity, entity_id, action, payload_json, note)
                  VALUES ('2026-06-05', ?, 'test', 'line_check_entries', 77, 'insert',
                          '{"item":"sour cherry filling","station":"Pastry","status":"pass"}',
                          'Pastry checked cherry filling temperature before wedding cake assembly.')
                  """,
                arguments: [self.LOC]
            )
            // NOT in SAFE_AUDIT_ENTITIES — must never surface at cook tier.
            try db.execute(
                sql: """
                  INSERT INTO audit_events (shift_date, location_id, actor_source, entity, entity_id, action, payload_json, note)
                  VALUES ('2026-06-05', ?, 'test', 'performance_reviews', 7, 'insert',
                          '{"cook_name":"Sam","feedback":"private cherry cake coaching note"}',
                          'Manager-only review should not appear in cook-tier semantic search.')
                  """,
                arguments: [self.LOC]
            )
        }
    }

    func testFindsRecipesBeoLinesAndSafeAuditsWithoutExactMatching() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        try seedRows(writeDB)

        let result = try repo.run(
            locationId: LOC,
            query: "that wedding cake recipe with the cherry filling",
            limit: 8
        )
        XCTAssertEqual(result.query, "that wedding cake recipe with the cherry filling")

        let types = Set(result.hits.map(\.type))
        XCTAssertTrue(types.contains(.recipe), "expected local recipe hit")
        XCTAssertTrue(types.contains(.beoLineItem), "expected location-scoped BEO line-item hit")
        XCTAssertTrue(types.contains(.auditEvent), "expected safe kitchen audit hit")

        let rendered = KitchenSemanticSearchCompute.formatForPrompt(result)
        XCTAssertTrue(rendered.contains("Almond Celebration Cake"))
        XCTAssertTrue(rendered.contains("Parker Wedding"))
        XCTAssertTrue(rendered.contains("sour cherry filling"))
        XCTAssertFalse(rendered.contains("Cross-location"), "foreign location rows never leak")
        XCTAssertFalse(rendered.lowercased().contains("performance review"),
                       "non-safe audit entities never surface at cook tier")
        XCTAssertFalse(rendered.contains("Manager-only review"))
    }

    func testEmptyQueryIsQuietNoHit() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        let result = try repo.run(locationId: LOC, query: "   ")
        XCTAssertEqual(result.hits, [])
        XCTAssertTrue(
            KitchenSemanticSearchCompute.formatForPrompt(result).contains("No semantic search matches")
        )
    }

    func testShortShorthandMatchesLineItem() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }
        _ = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO beo_events (title, event_date, contact_name, guest_count, notes, location_id)
                  VALUES ('Lopez Gluten-Free Rehearsal', '2026-06-22', 'Mia Lopez', 48,
                          'Separate gluten-free dessert plating on request.', ?)
                  """,
                arguments: [self.LOC]
            )
            let eventId = db.lastInsertedRowID
            try db.execute(
                sql: """
                  INSERT INTO beo_line_items (event_id, sort_order, item_name, category, quantity, unit_cost, prep_notes, group_note)
                  VALUES (?, 2, 'Berry cobbler', 'Dessert', 48, 3.25,
                          'GF cobbler needs a separate tray for the celiac guest.', 'Celiac dessert')
                  """,
                arguments: [eventId]
            )
        }
        let result = try repo.run(locationId: LOC, query: "GF", limit: 4)
        let hit = result.hits.first { $0.type == .beoLineItem && $0.title == "Berry cobbler" }
        XCTAssertNotNil(hit, "GF shorthand should match via normalized query")
        XCTAssertTrue(
            KitchenSemanticSearchCompute.formatForPrompt(result).lowercased().contains("gf cobbler")
        )
    }
}
