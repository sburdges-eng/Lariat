import Foundation
import GRDB
import LariatModel

public enum AuditEventWriterError: Error, LocalizedError {
    case outsideTransaction(entity: String, action: AuditEventAction)

    public var errorDescription: String? {
        switch self {
        case .outsideTransaction(let entity, let action):
            return """
            postAuditEvent called outside of a transaction context (entity=\(entity), action=\(action.rawValue)). \
            Atomicity is required — an audit failure must roll back the source row. \
            Wrap the source INSERT and the postAuditEvent call inside a single db.transaction(...).
            """
        }
    }
}

/// Append-only `audit_events` writer — parity with `postAuditEvent` in `lib/auditEvents.ts`.
public enum AuditEventWriter {
  /// Post one audit event. Returns the new row id. Must run inside the same GRDB write transaction as the source mutation.
  public static func post(db: Database, input: AuditEventInput) throws -> Int64 {
    guard db.isInsideTransaction else {
      throw AuditEventWriterError.outsideTransaction(entity: input.entity, action: input.action)
    }

    try db.execute(
      sql: """
        INSERT INTO audit_events (
          shift_date, location_id, actor_cook_id, actor_source,
          entity, entity_id, action, replaces_id, payload_json, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
      arguments: [
        input.shiftDate ?? ShiftDate.todayISO(),
        input.locationId ?? "default",
        input.actorCookId,
        input.actorSource,
        input.entity,
        input.entityId,
        input.action.rawValue,
        input.replacesId,
        payloadJSON(for: input),
        input.note,
      ]
    )
    return db.lastInsertedRowID
  }

  /// Serialize payload defensively — audit row must not fail on exotic values.
  static func payloadJSON(for input: AuditEventInput) -> String? {
    if let raw = input.payloadJSON { return raw }
    return safePayloadJSON(input.payload)
  }

  static func safePayloadJSON(_ payload: [String: String]?) -> String? {
    guard let payload else { return nil }
    guard let data = try? JSONEncoder().encode(payload),
          let json = String(data: data, encoding: .utf8)
    else {
      return "{\"_audit_serialization_error\":true}"
    }
    return json
  }

  /// Encode a structured row snapshot for resolve-route parity.
  public static func encodePayload<T: Encodable>(_ value: T) -> String {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    guard let data = try? encoder.encode(value),
          let json = String(data: data, encoding: .utf8)
    else {
      return "{\"_audit_serialization_error\":true}"
    }
    return json
  }
}
