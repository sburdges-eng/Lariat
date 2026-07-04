import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity tests for `BeoCascadeRepository` — `GET /api/beo/cascade`.
/// Oracle: tests/js/test-beo-cascade-api.mjs. The cascade client is injected
/// with recorded CLI outputs so no Python is spawned (the web tests run the
/// real CLI against real recipe data; the route semantics under test here —
/// validation, location verification, engine-error-in-payload — are
/// DB/route-level and fully covered without it).
final class BeoCascadeRepositoryTests: XCTestCase {
    private var fixture: BeoFixture!

    override func setUpWithError() throws {
        fixture = try BeoFixture.make()
    }

    override func tearDown() {
        fixture.cleanup()
        fixture = nil
    }

    private func repo(cliOutput: String) -> BeoCascadeRepository {
        BeoCascadeRepository(
            database: fixture.readDB,
            client: BeoCascadeClient(runner: { _, _ in cliOutput })
        )
    }

    private func failingRepo(_ error: CascadeError) -> BeoCascadeRepository {
        BeoCascadeRepository(
            database: fixture.readDB,
            client: BeoCascadeClient(runner: { _, _ in throw error })
        )
    }

    private static let emptyCli = #"{"order_guide": [], "prep_demands": [], "unmapped": []}"#

    // ── 400s ─────────────────────────────────────────────────────────────

    func testThrowsBadRequestForNonPositiveEventId() async {
        for bad: Int64 in [0, -5] {
            do {
                _ = try await repo(cliOutput: Self.emptyCli).cascade(eventId: bad, locationId: "default")
                XCTFail("expected badRequest for event_id \(bad)")
            } catch BeoWriteError.badRequest(let msg) {
                XCTAssertEqual(msg, "event_id required")
            } catch {
                XCTFail("expected badRequest, got \(error)")
            }
        }
    }

    // ── 404s ─────────────────────────────────────────────────────────────

    func testThrowsNotFoundForNonExistentEvent() async {
        do {
            _ = try await repo(cliOutput: Self.emptyCli).cascade(eventId: 99999, locationId: "default")
            XCTFail("expected notFound")
        } catch BeoWriteError.notFound(let msg) {
            XCTAssertEqual(msg, "event not found")
        } catch {
            XCTFail("expected notFound, got \(error)")
        }
    }

    func testThrowsNotFoundWhenEventBelongsToAnotherLocationNoLeak() async throws {
        let evId = try fixture.seedEvent(location: "austin")
        do {
            _ = try await repo(cliOutput: Self.emptyCli).cascade(eventId: evId, locationId: "default")
            XCTFail("expected notFound")
        } catch BeoWriteError.notFound(let msg) {
            // Same message for missing and wrong-location — no cross-location leak.
            XCTAssertEqual(msg, "event not found")
        } catch {
            XCTFail("expected notFound, got \(error)")
        }
    }

    // ── 200s ─────────────────────────────────────────────────────────────

    func testEventWithZeroLineItemsReturnsAllEmptyArrays() async throws {
        let evId = try fixture.seedEvent()
        // The client short-circuits on zero line items — no CLI call at all.
        var spawned = false
        let r = BeoCascadeRepository(
            database: fixture.readDB,
            client: BeoCascadeClient(runner: { _, _ in spawned = true; return Self.emptyCli })
        )
        let outcome = try await r.cascade(eventId: evId, locationId: "default")
        XCTAssertEqual(outcome.eventId, evId)
        XCTAssertTrue(outcome.orderGuide.isEmpty)
        XCTAssertTrue(outcome.prepDemands.isEmpty)
        XCTAssertTrue(outcome.unmapped.isEmpty)
        XCTAssertNil(outcome.engineError)
        XCTAssertFalse(spawned)
    }

    func testBogusItemsSurfaceInUnmapped() async throws {
        let evId = try fixture.seedEvent()
        try fixture.seedLineItem(eventId: evId, item: "__not_a_real_menu_item__", qty: 5)
        try fixture.seedLineItem(eventId: evId, item: "__also_fake_xyz_9999__", qty: 2)

        let cli = """
        {"order_guide": [], "prep_demands": [],
         "unmapped": [
           {"menu_item": "__not_a_real_menu_item__", "reason": "not in beo_recipe_map and no direct recipe match"},
           {"menu_item": "__also_fake_xyz_9999__", "reason": "not in beo_recipe_map and no direct recipe match"}]}
        """
        let outcome = try await repo(cliOutput: cli).cascade(eventId: evId, locationId: "default")
        XCTAssertEqual(outcome.eventId, evId)
        XCTAssertGreaterThanOrEqual(outcome.unmapped.count, 2)
        let names = outcome.unmapped.map(\.menuItem)
        XCTAssertTrue(names.contains("__not_a_real_menu_item__"))
        XCTAssertTrue(names.contains("__also_fake_xyz_9999__"))
        XCTAssertTrue(outcome.orderGuide.isEmpty)
        XCTAssertTrue(outcome.prepDemands.isEmpty)
    }

    func testSucceedsWhenLocationMatchesEventLocation() async throws {
        let evId = try fixture.seedEvent(location: "austin")
        let outcome = try await repo(cliOutput: Self.emptyCli).cascade(eventId: evId, locationId: "austin")
        XCTAssertEqual(outcome.eventId, evId)
    }

    /// Web: a CascadeError from the engine returns 200 with empty arrays and
    /// an `error` string (banner, not failure) — mirrored as engineError.
    func testEngineErrorSurfacesInOutcomeNotAsThrow() async throws {
        let evId = try fixture.seedEvent()
        try fixture.seedLineItem(eventId: evId, item: "Brisket", qty: 10)
        let outcome = try await failingRepo(
            CascadeError(message: "missing recipe_index.csv", code: "exit_2")
        ).cascade(eventId: evId, locationId: "default")
        XCTAssertEqual(outcome.eventId, evId)
        XCTAssertTrue(outcome.orderGuide.isEmpty)
        XCTAssertTrue(outcome.prepDemands.isEmpty)
        XCTAssertTrue(outcome.unmapped.isEmpty)
        XCTAssertEqual(outcome.engineError, "missing recipe_index.csv")
    }

    func testPassesQtyInYieldUnitsAndLineItemsToTheClient() async throws {
        // BEO quantities are item counts for pricing, not batch counts —
        // the route pins qty_in_yield_units: true.
        let evId = try fixture.seedEvent()
        try fixture.seedLineItem(eventId: evId, item: "Battered Fish Taco", qty: 40)

        var captured: [String: Any] = [:]
        let r = BeoCascadeRepository(
            database: fixture.readDB,
            client: BeoCascadeClient(runner: { payload, _ in
                captured = (try? JSONSerialization.jsonObject(with: payload) as? [String: Any]) ?? [:]
                return Self.emptyCli
            })
        )
        _ = try await r.cascade(eventId: evId, locationId: "default")
        XCTAssertEqual(captured["qty_in_yield_units"] as? Bool, true)
        let items = try XCTUnwrap(captured["line_items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0]["item_name"] as? String, "Battered Fish Taco")
    }

    // ── on-hand inventory wiring (Track C) ───────────────────────────────

    private func captureInventory(
        eventId: Int64,
        locationId: String
    ) async throws -> [[String: Any]] {
        var captured: [String: Any] = [:]
        let r = BeoCascadeRepository(
            database: fixture.readDB,
            client: BeoCascadeClient(runner: { payload, _ in
                captured = (try? JSONSerialization.jsonObject(with: payload) as? [String: Any]) ?? [:]
                return Self.emptyCli
            })
        )
        _ = try await r.cascade(eventId: eventId, locationId: locationId)
        return (captured["inventory"] as? [[String: Any]]) ?? []
    }

    /// Web parity: `route.js` loads the latest inventory count for the location
    /// and passes its non-null on-hand lines to the engine. Only the newest
    /// count applies — an earlier one is superseded.
    func testLoadsLatestInventoryCountForLocationAndPassesToClient() async throws {
        let evId = try fixture.seedEvent(location: "default")
        try fixture.seedLineItem(eventId: evId, item: "Battered Fish Taco", qty: 40)
        try fixture.seed { db in
            // Stale earlier count — must be superseded.
            try db.execute(sql: "INSERT INTO inventory_counts (id, count_date, location_id) VALUES (1, '2026-05-01', 'default')")
            try db.execute(sql: "INSERT INTO inventory_count_lines (count_id, ingredient, unit, on_hand_qty, location_id) VALUES (1, 'stale flour', 'lb', 99, 'default')")
            // Current count — the one that should be loaded.
            try db.execute(sql: "INSERT INTO inventory_counts (id, count_date, location_id) VALUES (2, '2026-06-01', 'default')")
            try db.execute(sql: "INSERT INTO inventory_count_lines (count_id, ingredient, unit, on_hand_qty, location_id) VALUES (2, 'cilantro', 'cup', 4, 'default')")
            // A NULL on-hand line in the current count must be filtered out.
            try db.execute(sql: "INSERT INTO inventory_count_lines (count_id, ingredient, unit, on_hand_qty, location_id) VALUES (2, 'garlic', 'cup', NULL, 'default')")
        }

        let inv = try await captureInventory(eventId: evId, locationId: "default")
        XCTAssertEqual(inv.count, 1, "only the latest count's non-null on-hand lines apply")
        let first = try XCTUnwrap(inv.first)
        XCTAssertEqual(first["ingredient"] as? String, "cilantro")
        XCTAssertEqual(first["unit"] as? String, "cup")
        XCTAssertEqual(first["on_hand"] as? Double, 4)
    }

    /// Location scoping: another location's count must not be applied to a
    /// default-location event — even if it is the newest count overall.
    func testDoesNotApplyAnotherLocationsInventory() async throws {
        let evId = try fixture.seedEvent(location: "default")
        try fixture.seedLineItem(eventId: evId, item: "Battered Fish Taco", qty: 40)
        try fixture.seed { db in
            try db.execute(sql: "INSERT INTO inventory_counts (id, count_date, location_id) VALUES (1, '2026-06-02', 'austin')")
            try db.execute(sql: "INSERT INTO inventory_count_lines (count_id, ingredient, unit, on_hand_qty, location_id) VALUES (1, 'cilantro', 'cup', 500, 'austin')")
        }

        let inv = try await captureInventory(eventId: evId, locationId: "default")
        XCTAssertTrue(inv.isEmpty, "another location's inventory must not be applied")
    }

    /// Web parity: the cascade route surfaces manifest_warnings from the engine
    /// (a declared sub-recipe no BOM row references) on the outcome.
    func testManifestWarningsSurfaceInOutcome() async throws {
        let evId = try fixture.seedEvent()
        try fixture.seedLineItem(eventId: evId, item: "Battered Fish Taco", qty: 40)
        let cli = """
        {"order_guide": [], "prep_demands": [], "unmapped": [],
         "manifest_warnings": [{"recipe": "beer_batter", "issue": "declares sub-recipe 'beer_flour' but no BOM row references it"}]}
        """
        let outcome = try await repo(cliOutput: cli).cascade(eventId: evId, locationId: "default")
        XCTAssertEqual(outcome.manifestWarnings.map(\.recipe), ["beer_batter"])
        XCTAssertEqual(
            outcome.manifestWarnings.first?.issue,
            "declares sub-recipe 'beer_flour' but no BOM row references it"
        )
    }
}
