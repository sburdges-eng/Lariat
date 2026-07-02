import XCTest
@testable import LariatModel

/// Authored against `app/floor/FloorPlan.jsx` (no web test file exists for
/// the floor UI layer — the route rules are covered by
/// `DiningTablesRepositoryTests`).
final class FloorComputeTests: XCTestCase {

    // ── actions(for:) — the ActionPanel state machine ────────────────────

    func testOpenTableActions() {
        let actions = FloorCompute.actions(for: "open")
        XCTAssertEqual(actions.map(\.target), ["seated", "dirty", "closed"])
        XCTAssertEqual(actions.first?.label, "Mark seated")
        XCTAssertEqual(actions.first?.isPrimary, true)
    }

    func testSeatedTableActions() {
        let actions = FloorCompute.actions(for: "seated")
        XCTAssertEqual(actions.map(\.target), ["dirty", "closed"])
        XCTAssertEqual(actions.first?.label, "Mark dirty")
    }

    func testDirtyTableActions() {
        let actions = FloorCompute.actions(for: "dirty")
        XCTAssertEqual(actions.map(\.target), ["open", "closed"])
        XCTAssertEqual(actions.first?.label, "Mark open")
    }

    func testClosedTableReopens() {
        let actions = FloorCompute.actions(for: "closed")
        XCTAssertEqual(actions, [FloorTableAction(label: "Reopen", target: "open", isPrimary: true)])
    }

    func testUnknownStatusFallsBackToReopen() {
        XCTAssertEqual(FloorCompute.actions(for: "on_fire").map(\.target), ["open"])
    }

    // ── statusCounts ─────────────────────────────────────────────────────

    func testStatusCounts() {
        let rows = [
            table(id: "T1", status: "open"),
            table(id: "T2", status: "seated"),
            table(id: "T3", status: "seated"),
            table(id: "T4", status: "dirty"),
            table(id: "T5", status: "closed"),
        ]
        let c = FloorCompute.statusCounts(rows)
        XCTAssertEqual(c, FloorStatusCounts(total: 5, open: 1, seated: 2, dirty: 1, closed: 1))
    }

    func testStatusCountsEmpty() {
        XCTAssertEqual(
            FloorCompute.statusCounts([]),
            FloorStatusCounts(total: 0, open: 0, seated: 0, dirty: 0, closed: 0)
        )
    }

    // ── starter set (STARTER_TABLES) ─────────────────────────────────────

    func testStarterTablesAreSixTwoTops() {
        let starters = FloorCompute.starterTables
        XCTAssertEqual(starters.map(\.id), ["T1", "T2", "T3", "T4", "T5", "T6"])
        for t in starters {
            XCTAssertEqual(t.capacity, 2)
            XCTAssertEqual(t.w, 1)
            XCTAssertEqual(t.h, 1)
        }
        // Two rows: y=0 for T1–T3, y=2 for T4–T6.
        XCTAssertEqual(starters.prefix(3).map(\.y), [0, 0, 0])
        XCTAssertEqual(starters.suffix(3).map(\.y), [2, 2, 2])
    }

    private func table(id: String, status: String) -> DiningTableRow {
        DiningTableRow(
            id: id, name: id, capacity: 2, x: 0, y: 0, w: 1, h: 1,
            status: status, notes: nil, locationId: "default",
            createdAt: nil, updatedAt: nil
        )
    }
}
