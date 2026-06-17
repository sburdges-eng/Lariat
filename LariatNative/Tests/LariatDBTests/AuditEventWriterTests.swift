import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Parity with `lib/auditEvents.ts` — regulated audit_events writes must run
/// inside the same SQLite transaction as the source mutation.
final class AuditEventWriterTests: XCTestCase {

  func testPostOutsideTransactionThrows() throws {
    let path = try seedFixtureDatabase()
    defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
    let db = try LariatWriteDatabase(path: path)
    try db.pool.writeWithoutTransaction { database in
      XCTAssertThrowsError(
        try AuditEventWriter.post(
          db: database,
          input: AuditEventInput(
            entity: "pack_size_changes",
            entityId: 1,
            action: .update,
            actorSource: RegulatedWriteContext.nativeMacActorSource
          )
        )
      ) { error in
        guard case AuditEventWriterError.outsideTransaction = error else {
          return XCTFail("expected outsideTransaction, got \(error)")
        }
      }
    }
  }

  func testPostInsideTransactionInsertsRow() throws {
    let path = try seedFixtureDatabase()
    defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
    let db = try LariatWriteDatabase(path: path)
    let context = RegulatedWriteContext.nativeMac(
      pinUser: ManagerPinUser(id: 7, locationId: "default", name: "Pat", role: "manager")
    )

    let (entityId, auditId): (Int64, Int64) = try db.write { database in
      try database.execute(
        sql: "INSERT INTO pack_size_changes (vendor, sku, acknowledged) VALUES ('TestCo', 'SKU-9', 0)"
      )
      let rowId = database.lastInsertedRowID
      let auditRowId = try AuditEventWriter.post(
        db: database,
        input: AuditEventInput(
          entity: "pack_size_changes",
          entityId: rowId,
          action: .update,
          actorCookId: context.actorCookId,
          actorSource: context.actorSource,
          payload: ["vendor": "TestCo", "sku": "SKU-9", "acknowledged": "1"],
          shiftDate: context.shiftDate,
          locationId: context.locationId
        )
      )
      return (rowId, auditRowId)
    }

    XCTAssertGreaterThan(auditId, 0)
    try db.pool.read { database in
      let row = try Row.fetchOne(
        database,
        sql: """
          SELECT entity, entity_id, action, actor_source, actor_cook_id, payload_json
          FROM audit_events WHERE id = ?
          """,
        arguments: [auditId]
      )
      XCTAssertEqual(row?["entity"] as String?, "pack_size_changes")
      XCTAssertEqual(row?["entity_id"] as Int64?, entityId)
      XCTAssertEqual(row?["action"] as String?, "update")
      XCTAssertEqual(row?["actor_source"] as String?, "native_mac")
      XCTAssertEqual(row?["actor_cook_id"] as String?, "7")
      let payload = row?["payload_json"] as String?
      XCTAssertTrue(payload?.contains("TestCo") == true)
    }
  }

  func testTransactionRollbackDropsAuditRow() throws {
    let path = try seedFixtureDatabase()
    defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
    let db = try LariatWriteDatabase(path: path)

    XCTAssertThrowsError(
      try db.write { database in
        try database.execute(
          sql: "INSERT INTO pack_size_changes (vendor, sku, acknowledged) VALUES ('Rollback', 'R-1', 0)"
        )
        let rowId = database.lastInsertedRowID
        _ = try AuditEventWriter.post(
          db: database,
          input: AuditEventInput(
            entity: "pack_size_changes",
            entityId: rowId,
            action: .update,
            actorSource: RegulatedWriteContext.nativeMacActorSource
          )
        )
        throw NSError(domain: "test", code: 1)
      }
    )

    try db.pool.read { database in
      XCTAssertEqual(try Int.fetchOne(database, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
      XCTAssertEqual(
        try Int.fetchOne(database, sql: "SELECT COUNT(*) FROM pack_size_changes WHERE vendor = 'Rollback'") ?? -1,
        0
      )
    }
  }

  func testAuditedWriteRunnerRollsBackOnFailure() throws {
    let path = try seedFixtureDatabase()
    defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
    let db = try LariatWriteDatabase(path: path)

    XCTAssertThrowsError(
      try AuditedWriteRunner.perform(db: db) { database in
        try database.execute(
          sql: "INSERT INTO pack_size_changes (vendor, sku, acknowledged) VALUES ('Runner', 'R-2', 0)"
        )
        let rowId = database.lastInsertedRowID
        _ = try AuditEventWriter.post(
          db: database,
          input: AuditEventInput(
            entity: "pack_size_changes",
            entityId: rowId,
            action: .update,
            actorSource: RegulatedWriteContext.nativeMacActorSource
          )
        )
        throw NSError(domain: "test", code: 2)
      }
    )

    try db.pool.read { database in
      XCTAssertEqual(try Int.fetchOne(database, sql: "SELECT COUNT(*) FROM audit_events") ?? -1, 0)
      XCTAssertEqual(
        try Int.fetchOne(database, sql: "SELECT COUNT(*) FROM pack_size_changes WHERE vendor = 'Runner'") ?? -1,
        0
      )
    }
  }
}
