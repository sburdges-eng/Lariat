import Foundation
import GRDB
import LariatModel

/// Runs a regulated write block inside one GRDB write transaction (source row + `AuditEventWriter.post` roll back together).
public enum AuditedWriteRunner {
  public static func perform<T>(
    db: LariatWriteDatabase,
    _ block: (Database) throws -> T
  ) throws -> T {
    try db.write(block)
  }
}
