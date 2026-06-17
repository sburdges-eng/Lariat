import XCTest
import GRDB
@testable import LariatModel

final class SchemaVersionTests: XCTestCase {

    // MARK: - Absence path (the normal case against real lariat.db)

    /// A fresh in-memory DB has user_version == 0 and no schema_migrations table.
    /// The guard must return .unknown and never throw.
    func testNoMarker_returnsUnknown() throws {
        let q = try DatabaseQueue()
        let state = try q.read { db in SchemaVersionGuard.probe(db) }
        XCTAssertEqual(state, .unknown)
    }

    // MARK: - user_version present path

    /// When user_version is set (e.g. via PRAGMA user_version = 7),
    /// the guard must return .known(7).
    func testUserVersionSet_returnsKnown() throws {
        let q = try DatabaseQueue()
        try q.write { db in
            try db.execute(sql: "PRAGMA user_version = 7")
        }
        let state = try q.read { db in SchemaVersionGuard.probe(db) }
        XCTAssertEqual(state, .known(7))
    }

    // MARK: - schema_migrations table present path

    /// When schema_migrations exists but user_version is still 0,
    /// the guard should recognise the table and return .known with the
    /// row count as a proxy version (or a fixed sentinel). The exact
    /// shape is an implementation detail — what matters is it does NOT
    /// return .unknown when the table is present.
    func testSchemaMigrationsTablePresent_returnsKnown() throws {
        let q = try DatabaseQueue()
        try q.write { db in
            try db.execute(sql: """
                CREATE TABLE schema_migrations (
                    version TEXT NOT NULL PRIMARY KEY
                )
            """)
            try db.execute(sql: "INSERT INTO schema_migrations VALUES ('20240101000000')")
            try db.execute(sql: "INSERT INTO schema_migrations VALUES ('20240202000000')")
        }
        let state = try q.read { db in SchemaVersionGuard.probe(db) }
        if case .unknown = state {
            XCTFail("Expected .known when schema_migrations table is present, got .unknown")
        }
    }

    // MARK: - Edge cases

    /// user_version == 0 AND no schema_migrations table → .unknown (double-checks the guard
    /// doesn't accidentally treat "0" as a real version marker).
    func testUserVersionZero_noTable_returnsUnknown() throws {
        let q = try DatabaseQueue()
        // user_version defaults to 0; never set it
        let state = try q.read { db in SchemaVersionGuard.probe(db) }
        XCTAssertEqual(state, .unknown)
    }

    /// The guard must be non-throwing even when the DB is truly minimal.
    func testProbeNeverThrows() {
        let q = try? DatabaseQueue()
        XCTAssertNotNil(q)
        XCTAssertNoThrow(try q!.read { db in SchemaVersionGuard.probe(db) })
    }
}
