import XCTest
@testable import LariatModel

/// Cross-language parity for the `audit_events.action` verb set.
///
/// The web schema constrains it via `CHECK(action IN (...))` in `lib/db.ts`;
/// the web gate `tests/js/test-audit-action-parity.mjs` introspects that live
/// CHECK and pins it to `tests/fixtures/audit_event_actions.json`. This side
/// pins the native `AuditEventAction` enum to the same fixture, so
/// `AuditEventWriter` can never emit a verb the web CHECK rejects (which would
/// be a runtime constraint failure on the shared DB) and vice versa. To add a
/// verb: update the DDL CHECK, the fixture, and the enum together.
final class AuditEventActionTests: XCTestCase {

    private struct Fixture: Decodable { let values: [String] }

    private func loadFixtureSet() throws -> Set<String> {
        // <root>/LariatNative/Tests/LariatModelTests/<thisfile> → up 4 → <root>
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        url.appendPathComponent("tests/fixtures/audit_event_actions.json")
        return Set(try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).values)
    }

    func testActionEnumMatchesSharedFixture() throws {
        let fixture = try loadFixtureSet()
        XCTAssertEqual(
            Set(AuditEventAction.allCases.map(\.rawValue)), fixture,
            "AuditEventAction drifted from tests/fixtures/audit_event_actions.json / the web CHECK"
        )
    }
}
