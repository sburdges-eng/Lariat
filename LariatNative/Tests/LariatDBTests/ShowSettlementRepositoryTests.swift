import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

// Behavior-parity ports of `tests/js/test-settlement-repo.mjs` (deal upsert
// + audit trail + settlement math) plus the repo-level cases of
// `tests/js/test-settlement-route.mjs` (validation 422 contract, GET null
// deal, 404 unknown show) and the UNIQUE(show_id, location_id) pin from
// `tests/js/test-schema-show-deals.mjs`. MONEY-CRITICAL — the exact cent
// values from the web tests are asserted byte-for-byte.
final class ShowSettlementRepositoryTests: XCTestCase {

    private let day = "2026-05-01"

    private func makeFixture() throws -> (ShowsFixture, ShowSettlementRepository) {
        let fx = try ShowsFixture.make()
        try fx.insertShow(id: 1, band: "Test Band", date: "2026-05-01", sourceRow: 1)
        let repo = ShowSettlementRepository(readDB: fx.readDB, writeDB: fx.writeDB, locationId: "default")
        return (fx, repo)
    }

    private func context() -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: nil,
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: "default",
            shiftDate: day
        )
    }

    private var sampleDeal: DealPoint {
        DealPoint(
            guaranteeCents: 100000,
            vsPctAfterCosts: 0.85,
            costsOffTop: [DealCost(label: "Sound", cents: 5000)],
            buyoutCents: 0
        )
    }

    private func dealAudit(_ fx: ShowsFixture) throws -> [Row] {
        try fx.writeDB.pool.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM audit_events WHERE entity = 'show_deal' ORDER BY id")
        }
    }

    // ── upsertDeal ─────────────────────────────────────────────────────

    func testInsertNewDealWritesOneAuditRow() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.upsertDeal(showId: 1, deal: sampleDeal, cookId: "cook-jane", context: context())

        let row = try fx.writeDB.pool.read { db in
            try Row.fetchOne(db, sql: "SELECT * FROM show_deals WHERE show_id = 1")
        }
        XCTAssertEqual(row?["guarantee_cents"] as Int?, 100000)
        XCTAssertEqual(row?["vs_pct_after_costs"] as Double?, 0.85)
        XCTAssertEqual(row?["updated_by_cook_id"] as String?, "cook-jane")

        let audit = try dealAudit(fx)
        XCTAssertEqual(audit.count, 1)
        XCTAssertEqual(audit[0]["action"] as String, "insert")
        XCTAssertEqual(audit[0]["actor_cook_id"] as String?, "cook-jane")
        XCTAssertEqual(audit[0]["actor_source"] as String, "native_mac")
        // Payload is the camelCase DealPoint DTO (JSON.stringify parity).
        let payload = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: Data((audit[0]["payload_json"] as String).utf8)
            ) as? [String: Any]
        )
        XCTAssertEqual(payload["guaranteeCents"] as? Int, 100000)
        XCTAssertEqual((payload["costsOffTop"] as? [[String: Any]])?.first?["cents"] as? Int, 5000)
    }

    func testUpdateExistingDealAuditsAsCorrection() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.upsertDeal(showId: 1, deal: sampleDeal, cookId: "cook-jane", context: context())
        try repo.upsertDeal(
            showId: 1,
            deal: DealPoint(guaranteeCents: 150000, vsPctAfterCosts: 0.85,
                            costsOffTop: sampleDeal.costsOffTop, buyoutCents: 0),
            cookId: "cook-bob",
            context: context()
        )
        let rows = try fx.writeDB.pool.read { db in
            try Row.fetchAll(db, sql: "SELECT * FROM show_deals WHERE show_id = 1")
        }
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0]["guarantee_cents"] as Int, 150000)

        let audit = try dealAudit(fx)
        XCTAssertEqual(audit.count, 2)
        XCTAssertEqual(audit[1]["action"] as String, "correction")
        XCTAssertEqual(audit[1]["actor_cook_id"] as String?, "cook-bob")
    }

    func testUpsertRollsBackAuditWhenDealInsertFails() throws {
        // FK violation (show 999 does not exist; foreign keys are ON) —
        // the audit row must roll back with the failed upsert.
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.upsertDeal(
            showId: 999, deal: sampleDeal, cookId: "cook-jane", context: context()
        )) { err in
            XCTAssertTrue("\(err)".uppercased().contains("FOREIGN KEY"), "\(err)")
        }
        XCTAssertEqual(try dealAudit(fx).count, 0)
    }

    func testEmptyCookIdFallsBackToUnknown() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.upsertDeal(showId: 1, deal: sampleDeal, cookId: "", context: context())
        let by = try fx.writeDB.pool.read { db in
            try String.fetchOne(db, sql: "SELECT updated_by_cook_id FROM show_deals WHERE show_id = 1")
        }
        XCTAssertEqual(by, "unknown")
    }

    // ── validation (PUT route 422 contract) ────────────────────────────

    func testUpsertRejectsNegativeGuaranteeBeforeWriting() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.upsertDeal(
            showId: 1,
            deal: DealPoint(guaranteeCents: -100, vsPctAfterCosts: nil, costsOffTop: [], buyoutCents: 0),
            cookId: "cook-jane", context: context()
        )) { err in
            XCTAssertEqual(err as? SettlementError,
                           .validation("guaranteeCents: non-negative integer required"))
        }
        let count = try fx.writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM show_deals") ?? -1
        }
        XCTAssertEqual(count, 0, "validation failure must not write")
        XCTAssertEqual(try dealAudit(fx).count, 0)
    }

    func testUpsertRejectsVsPctAboveOne() throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        XCTAssertThrowsError(try repo.upsertDeal(
            showId: 1,
            deal: DealPoint(guaranteeCents: 0, vsPctAfterCosts: 1.5, costsOffTop: [], buyoutCents: 0),
            cookId: "cook-jane", context: context()
        )) { err in
            XCTAssertEqual(err as? SettlementError, .validation("vsPctAfterCosts: null or 0-1"))
        }
    }

    // ── getDeal ────────────────────────────────────────────────────────

    func testGetDealNilWhenNoneEntered() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let deal = try await repo.getDeal(showId: 1)
        XCTAssertNil(deal)
    }

    func testGetDealRoundTripsAfterUpsert() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try repo.upsertDeal(showId: 1, deal: sampleDeal, cookId: "cook-jane", context: context())
        let deal = try await repo.getDeal(showId: 1)
        XCTAssertEqual(deal, sampleDeal)
    }

    // ── getSettlement ──────────────────────────────────────────────────

    func testSettlementEmptyDealPlusZerosWhenNothingEntered() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        let s = try await repo.getSettlement(showId: 1)
        XCTAssertEqual(s.show.id, 1)
        XCTAssertEqual(s.show.bandName, "Test Band")
        XCTAssertEqual(s.deal.guaranteeCents, 0)
        XCTAssertEqual(s.ticketing.grossCents, 0)
        XCTAssertEqual(s.toast.totalCents, 0)
        XCTAssertEqual(s.toast.rowsFound, 0)
        XCTAssertEqual(s.netDoorCents, 0)
    }

    func testSettlementAggregatesTicketRevenueAndFeesBySource() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees)
                VALUES (1, 'default', 'dice', 10, 35.00, 4.50),
                       (1, 'default', 'walkup', 5, 40.00, 0)
                """)
        }
        let s = try await repo.getSettlement(showId: 1)
        // dice: 10 × 35.00 → 35000c gross, 10 × 4.50 → 4500c fees
        // walkup: 5 × 40.00 → 20000c gross, 0 fees
        XCTAssertEqual(s.ticketing.grossCents, 55000)
        XCTAssertEqual(s.ticketing.feesCents, 4500)
        XCTAssertEqual(s.ticketing.netCents, 50500)
        XCTAssertEqual(s.ticketing.bySource[.dice]?.qty, 10)
        XCTAssertEqual(s.ticketing.bySource[.dice]?.grossCents, 35000)
        XCTAssertEqual(s.ticketing.bySource[.walkup]?.qty, 5)
    }

    func testSettlementAggregatesToastForShiftDateEqualShowDate() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO toast_sales_daily
                  (shift_date, net_sales, orders, guests, comparison_group, source, location_id)
                VALUES ('2026-05-01', 1234.56, 80, 120, 0, 'test', 'default'),
                       ('2026-04-30', 999.99, 50, 70, 0, 'test', 'default')
                """)
        }
        let s = try await repo.getSettlement(showId: 1)
        XCTAssertEqual(s.toast.totalCents, 123456)
        XCTAssertEqual(s.toast.ordersCount, 80)
        XCTAssertEqual(s.toast.guestsCount, 120)
        XCTAssertEqual(s.toast.rowsFound, 1)
        XCTAssertEqual(s.toast.attributionDate, "2026-05-01")
    }

    func testSettlementAppliesTalentPayoutFromDeal() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees)
                VALUES (1, 'default', 'dice', 100, 30.00, 3.00)
                """)
        }
        try repo.upsertDeal(showId: 1, deal: sampleDeal, cookId: "cook-jane", context: context())
        let s = try await repo.getSettlement(showId: 1)
        // gross = 300000c, fees = 30000c, net = 270000c
        // overage = 300000 − 5000 − 100000 = 195000
        // vsBonus = floor(195000 × 0.85) = 165750
        // talent = 100000 + 165750 + 0 = 265750
        // net_door = 270000 − 5000 − 265750 = −750
        XCTAssertEqual(s.ticketing.grossCents, 300000)
        XCTAssertEqual(s.talent.totalCents, 265750)
        XCTAssertEqual(s.costsOffTopCents, 5000)
        XCTAssertEqual(s.netDoorCents, -750)
    }

    func testSettlementThrowsWhenShowMissing() async throws {
        let (fx, repo) = try makeFixture()
        defer { fx.cleanup() }
        do {
            _ = try await repo.getSettlement(showId: 9999)
            XCTFail("expected showNotFound")
        } catch {
            XCTAssertEqual(error as? SettlementError, .showNotFound(9999))
        }
    }

    // ── schema pin (test-schema-show-deals) ────────────────────────────

    func testShowDealsUniqueConstraintOnShowAndLocation() throws {
        let (fx, _) = try makeFixture()
        defer { fx.cleanup() }
        try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO show_deals (show_id, location_id, guarantee_cents)
                VALUES (1, 'default', 1000)
                """)
        }
        XCTAssertThrowsError(try fx.seed { db in
            try db.execute(sql: """
                INSERT INTO show_deals (show_id, location_id, guarantee_cents)
                VALUES (1, 'default', 2000)
                """)
        })
    }
}
