import XCTest
import GRDB
@testable import LariatModel

final class TempPinVerifierTests: XCTestCase {
    func testPinNotRequiredForTodayWhenEnvSet() {
        let v = TempPinVerifier()
        XCTAssertFalse(
            v.pinRequiredForBackDate(shiftDate: ShiftDate.todayISO(), env: ["LARIAT_PIN": "1234"])
        )
    }

    func testPinRequiredForPastDateWhenEnvSet() {
        let v = TempPinVerifier()
        XCTAssertTrue(
            v.pinRequiredForBackDate(shiftDate: "2020-01-01", env: ["LARIAT_PIN": "1234"])
        )
    }

    func testMasterPinPassesScope() throws {
        let dbQueue = try DatabaseQueue()
        try dbQueue.write { db in
            try db.execute(sql: """
              CREATE TABLE manager_pin_users (
                id INTEGER PRIMARY KEY, location_id TEXT, name TEXT, role TEXT,
                pin_hash TEXT, is_active INTEGER
              );
              INSERT INTO manager_pin_users (location_id, name, role, pin_hash, is_active)
              VALUES ('default', 'Pat', 'manager', ?, 1);
              """, arguments: [PinHash.sha256Hex("1357")])
        }
        let v = TempPinVerifier()
        let ok = try dbQueue.read { db in
            try v.hasPinOrScope(pin: "1357", scope: TempPinVerifier.backDateScope, db: db)
        }
        XCTAssertTrue(ok)
    }

    func testTempPinWithScopePasses() throws {
        let dbQueue = try DatabaseQueue()
        let hash = PinHash.sha256Hex("2468")
        try dbQueue.write { db in
            try db.execute(sql: """
              CREATE TABLE temp_pins (
                id INTEGER PRIMARY KEY, pin_hash TEXT, scopes_json TEXT,
                expires_at TEXT, revoked_at TEXT
              );
              INSERT INTO temp_pins (pin_hash, scopes_json, expires_at, revoked_at)
              VALUES (?, ?, datetime('now', '+1 day'), NULL);
              """, arguments: [hash, #"["haccp.back_date"]"#])
        }
        let v = TempPinVerifier()
        let ok = try dbQueue.read { db in
            try v.hasPinOrScope(pin: "2468", scope: TempPinVerifier.backDateScope, db: db)
        }
        XCTAssertTrue(ok)
    }

    func testParseScopes() {
        XCTAssertEqual(TempPinVerifier.parseScopes(#"["haccp.back_date","menu.specials_edit"]"#),
                       ["haccp.back_date", "menu.specials_edit"])
        XCTAssertEqual(TempPinVerifier.parseScopes(nil), [])
    }
}
