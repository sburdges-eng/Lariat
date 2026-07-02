import Foundation
import GRDB
import LariatModel

/// Typed port of the web undo failure contract — `status` carries the HTTP
/// code the route would return (400/404/409/500) so parity tests can pin it.
public struct AssistantUndoError: Error, Equatable, LocalizedError {
    public let status: Int
    public let message: String

    public init(status: Int, message: String) {
        self.status = status
        self.message = message
    }

    public var errorDescription: String? { message }
}

public struct AssistantUndoSuccess: Sendable, Equatable {
    public let message: String
    public let correctedAuditId: Int64

    public init(message: String, correctedAuditId: Int64) {
        self.message = message
        self.correctedAuditId = correctedAuditId
    }
}

/// Port of `undoKitchenAssistantAction` in `lib/kitchenAssistantUndo.ts`.
/// One transaction: eligibility checks → resolve/delete → `action='correction'`
/// audit row (`replaces_id` → original, `actor_source='kitchen_assistant_undo'`,
/// note 'undo_30s', payload with before/after snapshots). The original audit
/// row is NEVER mutated — append-only trail.
public struct AssistantUndoRepository {
    public static let actorSource = "kitchen_assistant_undo"

    private let writeDB: LariatWriteDatabase

    public init(writeDB: LariatWriteDatabase) {
        self.writeDB = writeDB
    }

    public func undo(
        auditEventId: Int64,
        locationId: String,
        cookId: String?,
        now: Date = Date()
    ) throws -> AssistantUndoSuccess {
        guard auditEventId > 0 else {
            throw AssistantUndoError(status: 400, message: "Undo id is missing.")
        }

        return try writeDB.write { db in
            guard let original = try Row.fetchOne(
                db, sql: "SELECT * FROM audit_events WHERE id = ?", arguments: [auditEventId]
            ) else {
                throw AssistantUndoError(status: 404, message: "That action is gone.")
            }
            let originalLocation: String? = original["location_id"]
            guard originalLocation == locationId else {
                throw AssistantUndoError(status: 404, message: "That action is gone.")
            }
            let actorSource: String? = original["actor_source"]
            let action: String? = original["action"]
            guard actorSource == AssistantActionRepository.actorSource, action == "insert" else {
                throw AssistantUndoError(status: 409, message: "That action cannot be undone.")
            }
            let entityName: String? = original["entity"]
            let entityId: Int64? = original["entity_id"]
            guard let entity = AssistantUndoCompute.undoableEntity(entityName),
                  let entityId, entityId > 0
            else {
                throw AssistantUndoError(status: 409, message: "That action cannot be undone.")
            }
            let createdAt: String? = original["created_at"]
            let createdAtMs = AssistantUndoCompute.normalizeTimestampMs(createdAt ?? "")
            guard createdAtMs.isFinite else {
                throw AssistantUndoError(status: 409, message: "That action cannot be checked right now.")
            }
            if now.timeIntervalSince1970 * 1000 - createdAtMs > AssistantUndoCompute.undoWindowMs {
                throw AssistantUndoError(status: 409, message: "Undo time ran out.")
            }
            let priorCorrection = try Int64.fetchOne(
                db, sql: "SELECT id FROM audit_events WHERE replaces_id = ? LIMIT 1",
                arguments: [auditEventId]
            )
            guard priorCorrection == nil else {
                throw AssistantUndoError(status: 409, message: "That action was already undone.")
            }

            guard let beforeRow = try Row.fetchOne(
                db, sql: "SELECT * FROM \(entity.table) WHERE id = ?", arguments: [entityId]
            ) else {
                throw AssistantUndoError(status: 409, message: "That action was already changed.")
            }

            var afterJSON = "null"
            let message: String
            switch entity.mode {
            case .resolveEightySix:
                try db.execute(
                    sql: "UPDATE \(entity.table) SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL",
                    arguments: [
                        LariConversationMemoryCompute.isoString(),
                        (cookId?.isEmpty == false ? cookId! : Self.actorSource),
                        entityId,
                    ]
                )
                guard db.changesCount == 1 else {
                    throw AssistantUndoError(status: 409, message: "That 86 was already cleared.")
                }
                if let after = try Row.fetchOne(
                    db, sql: "SELECT * FROM \(entity.table) WHERE id = ?", arguments: [entityId]
                ) {
                    afterJSON = Self.rowJSON(after)
                }
                message = AssistantUndoCompute.undoSuccessMessage(
                    entity: entity,
                    beforeItem: beforeRow["item"],
                    beforeIngredient: beforeRow["ingredient"],
                    beforeCookName: beforeRow["cook_name"]
                )
            case .deleteRow:
                try db.execute(sql: "DELETE FROM \(entity.table) WHERE id = ?", arguments: [entityId])
                guard db.changesCount == 1 else {
                    throw AssistantUndoError(status: 409, message: "That action was already cleared.")
                }
                message = AssistantUndoCompute.undoSuccessMessage(
                    entity: entity,
                    beforeItem: beforeRow["item"],
                    beforeIngredient: beforeRow["ingredient"],
                    beforeCookName: beforeRow["cook_name"]
                )
            }

            let payloadJSON = "{\"undo_window_ms\":\(Int(AssistantUndoCompute.undoWindowMs))"
                + ",\"original_audit_event_id\":\(auditEventId)"
                + ",\"before\":\(Self.rowJSON(beforeRow))"
                + ",\"after\":\(afterJSON)}"

            let correctedAuditId = try AuditEventWriter.post(db: db, input: AuditEventInput(
                entity: entity.rawValue,
                entityId: entityId,
                action: .correction,
                actorCookId: cookId,
                actorSource: Self.actorSource,
                replacesId: auditEventId,
                payloadJSON: payloadJSON,
                note: "undo_30s",
                shiftDate: original["shift_date"],
                locationId: originalLocation
            ))

            return AssistantUndoSuccess(message: message, correctedAuditId: correctedAuditId)
        }
    }

    /// JSON-encode a source row snapshot (web: the raw better-sqlite3 row
    /// object through JSON.stringify). Key order follows the table's column
    /// order, like the web row object.
    static func rowJSON(_ row: Row) -> String {
        var parts: [String] = []
        for (column, dbValue) in row {
            let encoded: String
            switch dbValue.storage {
            case .null:
                encoded = "null"
            case .int64(let i):
                encoded = String(i)
            case .double(let d):
                encoded = JsValueFormat.numberString(d)
            case .string(let s):
                encoded = JsValueFormat.jsonString(s)
            case .blob:
                encoded = "null"
            }
            parts.append("\(JsValueFormat.jsonString(column)):\(encoded)")
        }
        return "{" + parts.joined(separator: ",") + "}"
    }
}
