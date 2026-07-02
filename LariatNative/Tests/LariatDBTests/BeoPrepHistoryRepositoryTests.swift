import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity tests for `BeoPrepHistoryRepository` — `GET /api/beo/prep-history` +
/// the four `lib/beoPrepHistory.ts` accessors. Oracle:
/// tests/js/test-beo-prep-history-api.mjs. `getPrepMedianForItems` and
/// `getRecipePrepHistory` have no JS oracle — those cases are authored against
/// the web module code (documented in the plan doc).
final class BeoPrepHistoryRepositoryTests: XCTestCase {
    private var fixture: BeoFixture!
    private var repo: BeoPrepHistoryRepository!

    override func setUpWithError() throws {
        fixture = try BeoFixture.make()
        repo = BeoPrepHistoryRepository(database: fixture.readDB)
    }

    override func tearDown() {
        fixture.cleanup()
        fixture = nil
        repo = nil
    }

    // ── getItemPrepHistory ───────────────────────────────────────────────

    func testReturnsEmptyForEmptyItemsList() async throws {
        try fixture.seedPrepHistory(item: "Mac Balls")
        let out = try await repo.itemPrepHistory(items: [], limit: 5, locationId: "default")
        XCTAssertTrue(out.isEmpty)
    }

    func testMatchesCaseInsensitivelyOnExactItemName() async throws {
        try fixture.seedPrepHistory(item: "Mac Balls", amountQty: "50")
        let out = try await repo.itemPrepHistory(items: ["mac balls"], locationId: "default")
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].item, "mac balls")
        XCTAssertEqual(out[0].history.count, 1)
        XCTAssertEqual(out[0].history[0].amountQty, "50")
    }

    func testOmitsItemsWithNoHistory() async throws {
        try fixture.seedPrepHistory(item: "Mac Balls")
        let out = try await repo.itemPrepHistory(items: ["Mac Balls", "Carnitas"], locationId: "default")
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].item, "Mac Balls")
    }

    func testOrdersHistoryDescByEventDateWithNullLast() async throws {
        try fixture.seedPrepHistory(eventDate: "2026-04-01", item: "Mac Balls", amountQty: "A")
        try fixture.seedPrepHistory(eventDate: "2026-03-01", item: "Mac Balls", amountQty: "B")
        try fixture.seedPrepHistory(eventDate: nil, item: "Mac Balls", amountQty: "C")
        let out = try await repo.itemPrepHistory(items: ["Mac Balls"], locationId: "default")
        XCTAssertEqual(out[0].history.map(\.amountQty), ["A", "B", "C"])
    }

    func testRespectsLimitAndClampsTo25() async throws {
        for i in 0..<30 {
            try fixture.seedPrepHistory(
                eventDate: String(format: "2026-01-%02d", i + 1), item: "Mac Balls")
        }
        let two = try await repo.itemPrepHistory(items: ["Mac Balls"], limit: 2, locationId: "default")
        XCTAssertEqual(two[0].history.count, 2)
        let zero = try await repo.itemPrepHistory(items: ["Mac Balls"], limit: 0, locationId: "default")
        XCTAssertEqual(zero[0].history.count, 5)     // non-positive → default
        let big = try await repo.itemPrepHistory(items: ["Mac Balls"], limit: 999, locationId: "default")
        XCTAssertEqual(big[0].history.count, 25)     // overshoot clamped
    }

    func testRespectsLocationIsolation() async throws {
        try fixture.seedPrepHistory(item: "Mac Balls", location: "other-location")
        let out = try await repo.itemPrepHistory(items: ["Mac Balls"], locationId: "default")
        XCTAssertTrue(out.isEmpty)
    }

    func testDedupesItemsListAndIgnoresBlanks() async throws {
        try fixture.seedPrepHistory(item: "Mac Balls")
        let out = try await repo.itemPrepHistory(
            items: ["Mac Balls", "mac balls", "", "  ", "Mac Balls"], locationId: "default")
        // Case-sensitive dedupe of the cleaned list; both survivors match the
        // same underlying row case-insensitively.
        XCTAssertEqual(out.map(\.item), ["Mac Balls", "mac balls"])
        XCTAssertEqual(out.reduce(0) { $0 + $1.history.count }, 2)
    }

    /// Route-level cap (`MAX_ITEMS_PER_REQUEST = 50`): item #51+ is dropped.
    func testCapsItemsListAtFifty() async throws {
        try fixture.seedPrepHistory(item: "Mac Balls")
        var items = (0..<60).map { "Bogus \($0)" }
        items.append("Mac Balls")
        let out = try await repo.itemPrepHistory(items: items, locationId: "default")
        XCTAssertTrue(out.isEmpty, "Mac Balls is item #61 — the route slices to 50 so it's dropped")
    }

    // ── getRecentEvents ──────────────────────────────────────────────────

    func testRecentEventsGroupsByClientAndDateMostRecentFirst() async throws {
        try fixture.seedPrepHistory(client: "Smith", eventDate: "2026-04-01", item: "Mac Balls")
        try fixture.seedPrepHistory(client: "Smith", eventDate: "2026-04-01", item: "Caprese")
        try fixture.seedPrepHistory(client: "Jones", eventDate: "2026-03-01", item: "Birria")
        let recent = try await repo.recentEvents(limit: 2, locationId: "default")
        XCTAssertEqual(recent.count, 2)
        XCTAssertEqual(recent[0].eventDate, "2026-04-01")
        XCTAssertEqual(recent[0].client, "Smith")
        XCTAssertEqual(recent[0].items.count, 2)
    }

    func testRecentEventsFilterToMainItemRows() async throws {
        try fixture.seedPrepHistory(client: "X", eventDate: "2026-04-01", type: "Main Item", item: "Mac Balls")
        try fixture.seedPrepHistory(client: "X", eventDate: "2026-04-01", type: "Secondary Prep", item: "Queso")
        try fixture.seedPrepHistory(client: "X", eventDate: "2026-04-01", type: "Special Sauce", item: "Nash Oil")
        let recent = try await repo.recentEvents(locationId: "default")
        XCTAssertEqual(recent.count, 1)
        XCTAssertEqual(recent[0].items.map(\.item), ["Mac Balls"])
    }

    func testRecentEventsCapsGroupCount() async throws {
        for day in 1...8 {
            try fixture.seedPrepHistory(
                client: "C\(day)", eventDate: String(format: "2026-05-%02d", day), item: "Item \(day)")
        }
        let recent = try await repo.recentEvents(limit: 3, locationId: "default")
        XCTAssertEqual(recent.count, 3)
        XCTAssertEqual(recent.map(\.eventDate), ["2026-05-08", "2026-05-07", "2026-05-06"])
    }

    // ── getPrepMedianForItems (authored against web code) ────────────────

    func testPrepMediansComputeAcrossNumericSamples() async throws {
        try fixture.seedPrepHistory(eventDate: "2026-01-01", item: "Mac Balls", amountQty: "40")
        try fixture.seedPrepHistory(eventDate: "2026-02-01", item: "Mac Balls", amountQty: "50 ea")
        try fixture.seedPrepHistory(eventDate: "2026-03-01", item: "Mac Balls", amountQty: "60")
        try fixture.seedPrepHistory(eventDate: "2026-04-01", item: "Mac Balls", amountQty: "as needed")
        let out = try await repo.prepMedians(items: ["Mac Balls"], locationId: "default")
        let m = try XCTUnwrap(out["mac balls"])
        XCTAssertEqual(m.median, 50)
        XCTAssertEqual(m.samples, 3)      // "as needed" excluded from the population
        XCTAssertEqual(m.totalRows, 4)    // but counted in total_rows
        XCTAssertEqual(m.item, "Mac Balls")
    }

    func testPrepMediansOmitItemsWithZeroNumericSamples() async throws {
        try fixture.seedPrepHistory(item: "Garnish", amountQty: "as needed")
        let out = try await repo.prepMedians(items: ["Garnish", "Unknown"], locationId: "default")
        XCTAssertTrue(out.isEmpty, "no numeric samples → omitted (callers use map.has)")
    }

    // ── getRecipePrepHistory (authored against web code) ─────────────────

    func testRecipeHistoryMatchesBidirectionally() async throws {
        try fixture.seedPrepHistory(eventDate: "2026-04-01", item: "Carnitas Tacos Buffet")
        try fixture.seedPrepHistory(eventDate: "2026-03-01", item: "Aji")
        try fixture.seedPrepHistory(eventDate: "2026-02-01", item: "Cheesecake")

        // Direction A: item contains the recipe name.
        let tacos = try await repo.recipePrepHistory(recipeName: "Tacos", locationId: "default")
        XCTAssertEqual(tacos.map(\.item), ["Carnitas Tacos Buffet"])

        // Direction B: recipe name contains the (>=3 char) item.
        let aji = try await repo.recipePrepHistory(recipeName: "Aji Verde", locationId: "default")
        XCTAssertEqual(aji.map(\.item), ["Aji"])
    }

    func testRecipeHistoryReturnsEmptyForShortRecipeNames() async throws {
        try fixture.seedPrepHistory(item: "Aji")
        let out = try await repo.recipePrepHistory(recipeName: "Aj", locationId: "default")
        XCTAssertTrue(out.isEmpty, "recipe names under 3 chars would match everything")
    }

    func testRecipeHistoryOrdersMostRecentFirstAndRespectsCap() async throws {
        try fixture.seedPrepHistory(eventDate: "2026-01-01", item: "Fish Taco Buffet")
        try fixture.seedPrepHistory(eventDate: "2026-03-01", item: "Carnitas Tacos Buffet")
        try fixture.seedPrepHistory(eventDate: nil, item: "Taco Bar")
        let out = try await repo.recipePrepHistory(recipeName: "Taco", limit: 2, locationId: "default")
        XCTAssertEqual(out.map(\.item), ["Carnitas Tacos Buffet", "Fish Taco Buffet"],
                       "DESC by event_date, NULL last, capped at limit")
    }
}
