import Foundation
import GRDB
import LariatModel

public struct EightySixRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let catalog: StationCatalog

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, catalog: StationCatalog) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.catalog = catalog
    }

    public func load(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> EightySixBoardSnapshot {
        try await readDB.pool.read { db in
            let active = try EightySixRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM eighty_six
                  WHERE shift_date = ? AND location_id = ? AND resolved_at IS NULL
                  ORDER BY id DESC
                  """,
                arguments: [date, locationId]
            )
            let resolved = try EightySixRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM eighty_six
                  WHERE shift_date = ? AND location_id = ? AND resolved_at IS NOT NULL
                  ORDER BY resolved_at DESC
                  LIMIT 50
                  """,
                arguments: [date, locationId]
            )
            let activeItems = active.map(\.item).filter { !$0.isEmpty }
            let cascaded = SubRecipeCascadeCompute.cascadedFromEightySix(
                itemsEightySixed: activeItems,
                recipes: catalog.recipes
            )
            return EightySixBoardSnapshot(active: active, resolved: resolved, cascaded: cascaded)
        }
    }

    @discardableResult
    public func add(input: EightySixAddInput, context: RegulatedWriteContext) throws -> Int64 {
        let item = clip(input.item, max: 300)
        guard let item, !item.isEmpty else { throw EightySixWriteError.itemRequired }

        let locationId = context.locationId
        let stationId = clip(input.stationId, max: 64)
        let kind = clip(input.kind, max: 32) ?? "item"
        let reason = clip(input.reason, max: 100)
        let quantity = clip(input.quantity, max: 64)
        let cookId = clip(input.cookId, max: 64)
        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO eighty_six (
                    shift_date, station_id, item, kind, reason, quantity, cook_id, location_id
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [shiftDate, stationId, item, kind, reason, quantity, cookId, locationId]
            )
            let newId = db.lastInsertedRowID
            var payload: [String: String] = ["item": item, "kind": kind]
            if let reason { payload["reason"] = reason }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "eighty_six",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payload: payload,
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return newId
        }
    }

    @discardableResult
    public func resolve(id: Int64, context: RegulatedWriteContext) throws -> EightySixRow {
        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try EightySixRow.fetchOne(
                db,
                sql: "SELECT * FROM eighty_six WHERE id = ?",
                arguments: [id]
            ) else {
                throw EightySixWriteError.notFound
            }

            if existing.locationId != context.locationId {
                throw EightySixWriteError.notFound
            }
            if existing.resolvedAt != nil {
                throw EightySixWriteError.alreadyResolved
            }

            try db.execute(
                sql: """
                  UPDATE eighty_six
                  SET resolved_at = datetime('now'), resolved_by = ?
                  WHERE id = ?
                  """,
                arguments: [context.actorCookId, id]
            )

            guard let updated = try EightySixRow.fetchOne(
                db,
                sql: "SELECT * FROM eighty_six WHERE id = ?",
                arguments: [id]
            ) else {
                throw EightySixWriteError.notFound
            }

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "eighty_six",
                    entityId: id,
                    action: .update,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(updated),
                    note: "resolved",
                    shiftDate: existing.shiftDate,
                    locationId: existing.locationId
                )
            )
            return updated
        }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
