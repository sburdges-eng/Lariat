import XCTest
@testable import LariatModel

/// Cross-language parity for the venue service date. Loads the SAME shared
/// fixture the web suite pins — `tests/fixtures/service_date_parity.json` —
/// and asserts `ShiftDate.serviceDate(at:)` matches every expected value.
/// Pointing at the shared repo fixture (not a LariatNative-local copy) is
/// what makes this a real cross-stack gate.
///
/// Spec: `docs/superpowers/specs/2026-08-06-service-date-design.md` step 8.
final class ServiceDateParityTests: XCTestCase {

    struct Fixture: Decodable {
        let timezone: String
        let boundaryHourLocal: Int
        let cases: [Case]

        enum CodingKeys: String, CodingKey {
            case timezone, cases
            case boundaryHourLocal = "boundary_hour_local"
        }

        struct Case: Decodable {
            let at: String
            let local: String
            let expect: String
            let why: String
        }
    }

    /// `<repo>/tests/fixtures/service_date_parity.json`
    static var fixtureURL: URL {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url.appendPathComponent("tests/fixtures/service_date_parity.json")
        return url
    }

    func loadFixture() throws -> Fixture {
        let data = try Data(contentsOf: Self.fixtureURL)
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    func testDeclaresTheRuleTheFixtureWasBuiltAgainst() throws {
        let fx = try loadFixture()
        XCTAssertEqual(ShiftDate.venueTimeZoneIdentifier, fx.timezone)
        XCTAssertEqual(ShiftDate.serviceDayStartHour, fx.boundaryHourLocal)
    }

    func testAgreesWithSharedBoundaryFixtureOnEveryCase() throws {
        let fx = try loadFixture()
        XCTAssertGreaterThanOrEqual(fx.cases.count, 8, "fixture missing DST / boundary rows")

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]

        for row in fx.cases {
            guard let at = iso.date(from: row.at) else {
                XCTFail("unparseable fixture instant \(row.at)")
                continue
            }
            XCTAssertEqual(
                ShiftDate.serviceDate(at: at),
                row.expect,
                "\(row.at) (\(row.local)) should be service day \(row.expect) — \(row.why)"
            )
        }
    }

    func testDoesNotRollOverAt1800Local() {
        // 6 Aug 20:00 MDT. UTC slice would say the 7th.
        let dinner = ISO8601DateFormatter().date(from: "2026-08-07T02:00:00Z")!
        XCTAssertEqual(ShiftDate.todayISO(from: dinner), "2026-08-07", "sanity: UTC really does say the 7th")
        XCTAssertEqual(ShiftDate.serviceDate(at: dinner), "2026-08-06")
    }

    func testKeepsAWholeServiceDayOnOneDateAcrossMidnight() {
        let iso = ISO8601DateFormatter()
        let open = iso.date(from: "2026-08-06T22:00:00Z")!  // 6 Aug 16:00 MDT
        let close = iso.date(from: "2026-08-07T07:30:00Z")! // 7 Aug 01:30 MDT
        XCTAssertEqual(ShiftDate.serviceDate(at: open), ShiftDate.serviceDate(at: close))
    }

    func testTodayISOStaysUTC() {
        let dinner = ISO8601DateFormatter().date(from: "2026-08-07T02:00:00Z")!
        XCTAssertEqual(ShiftDate.todayISO(from: dinner), "2026-08-07")
        XCTAssertNotEqual(ShiftDate.todayISO(from: dinner), ShiftDate.serviceDate(at: dinner))
    }
}
