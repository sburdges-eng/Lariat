import Foundation
import GRDB
import LariatModel

/// Repository for standing prep par targets — behavior parity with
/// `app/api/prep-par/route.js` and the list/group logic in `app/prep/par/page.jsx`.
///
/// Reads via the read-only pool; regulated writes (upsert / delete) go through
/// `AuditedWriteRunner` so the `prep_par` mutation and its `audit_events` row
/// commit (or roll back) in ONE transaction. Semantics mirror the web route:
///   - both recipe_slug and ingredient empty → recipeOrIngredientRequired (web 400)
///   - upsert keyed on (location_id, station_id, recipe_slug, ingredient):
///       existing → UPDATE + audit 'update'; absent → INSERT + audit 'insert'
///   - DELETE non-positive id → badId (web 400)
///   - DELETE row absent in location → notFound (web 404)
public struct PrepParRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // Audit payloads — mixed number/string objects matching the web route,
    // so the recorded JSON keeps target_qty as a number (not a string).
    private struct UpsertAuditPayload: Encodable {
        let station_id: String
        let recipe_slug: String
        let ingredient: String
        let target_qty: Double?
        let unit: String?
    }
    private struct DeleteAuditPayload: Encodable {
        let recipe_slug: String
        let ingredient: String
    }

    private static func encode<T: Encodable>(_ value: T) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let json = String(data: data, encoding: .utf8)
        else { return "{\"_audit_serialization_error\":true}" }
        return json
    }

    // ── GET — list scoped by location + optional station filter ─────────

    /// Load prep par rows for a location, optionally filtered by station, ordered
    /// `station_id, sort_order, recipe_slug, ingredient` (identical to the web
    /// query), then grouped by station for display.
    public func load(
        stationId: String? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> PrepParBoardSnapshot {
        let station = PrepParCompute.clip(stationId, max: PrepParCompute.stationMax)
        return try await readDB.pool.read { db in
            var sql = """
              SELECT id, location_id, station_id, recipe_slug, ingredient,
                     target_qty, unit, sort_order, note, updated_at
                FROM prep_par
               WHERE location_id = ?
              """
            var arguments: [DatabaseValueConvertible] = [locationId]
            if let station {
                sql += " AND station_id = ?"
                arguments.append(station)
            }
            sql += " ORDER BY station_id, sort_order, recipe_slug, ingredient"
            let rows = try PrepParRow.fetchAll(db, sql: sql, arguments: StatementArguments(arguments))
            return PrepParBoardSnapshot(
                locationId: locationId,
                stationFilter: station,
                rows: rows,
                groups: PrepParCompute.group(rows)
            )
        }
    }

    // ── POST — upsert one target (insert or update) ─────────────────────

    /// Upsert a prep par target. Insert emits an `insert` audit; matching an
    /// existing (location, station, recipe_slug, ingredient) row updates it and
    /// emits an `update` audit. Both the write and the audit row commit atomically.
    @discardableResult
    public func upsert(
        input: PrepParUpsertInput,
        context: RegulatedWriteContext
    ) throws -> PrepParUpsertResult {
        let normalized: PrepParNormalized
        switch PrepParCompute.normalize(input) {
        case .failure(let err): throw err
        case .success(let n): normalized = n
        }

        let cookId = PrepParCompute.clip(input.cookId, max: 64) ?? context.actorCookId
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            let existingId = try Int64.fetchOne(
                db,
                sql: """
                  SELECT id FROM prep_par
                   WHERE location_id = ? AND station_id = ? AND recipe_slug = ? AND ingredient = ?
                  """,
                arguments: [locationId, normalized.stationId, normalized.recipeSlug, normalized.ingredient]
            )

            let id: Int64
            let isInsert: Bool
            if let existingId {
                id = existingId
                isInsert = false
                try db.execute(
                    sql: """
                      UPDATE prep_par
                         SET target_qty = ?, unit = ?, sort_order = ?, note = ?,
                             updated_at = datetime('now')
                       WHERE id = ?
                      """,
                    arguments: [normalized.targetQty, normalized.unit, normalized.sortOrder, normalized.note, id]
                )
            } else {
                try db.execute(
                    sql: """
                      INSERT INTO prep_par
                        (location_id, station_id, recipe_slug, ingredient, target_qty, unit, sort_order, note)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      """,
                    arguments: [
                        locationId, normalized.stationId, normalized.recipeSlug, normalized.ingredient,
                        normalized.targetQty, normalized.unit, normalized.sortOrder, normalized.note,
                    ]
                )
                id = db.lastInsertedRowID
                isInsert = true
            }

            let payload = UpsertAuditPayload(
                station_id: normalized.stationId,
                recipe_slug: normalized.recipeSlug,
                ingredient: normalized.ingredient,
                target_qty: normalized.targetQty,
                unit: normalized.unit
            )
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "prep_par",
                    entityId: id,
                    action: isInsert ? .insert : .update,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payloadJSON: Self.encode(payload),
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
            return PrepParUpsertResult(id: id, isInsert: isInsert)
        }
    }

    // ── DELETE — remove one target ──────────────────────────────────────

    /// Delete a prep par target. Non-positive id → `badId` (web 400). A row absent
    /// in the requested location → `notFound` (web 404, also the cross-location
    /// IDOR guard). Otherwise the DELETE and its `delete` audit commit atomically.
    public func delete(
        id: Int64,
        context: RegulatedWriteContext
    ) throws {
        switch PrepParCompute.validateDeleteId(id) {
        case .failure(let err): throw err
        case .success: break
        }
        let cookId = context.actorCookId
        let locationId = context.locationId

        try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT recipe_slug, ingredient FROM prep_par WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            ) else {
                throw PrepParWriteError.notFound
            }
            let recipeSlug: String = row["recipe_slug"] ?? ""
            let ingredient: String = row["ingredient"] ?? ""

            try db.execute(sql: "DELETE FROM prep_par WHERE id = ?", arguments: [id])

            let payload = DeleteAuditPayload(recipe_slug: recipeSlug, ingredient: ingredient)
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "prep_par",
                    entityId: id,
                    action: .delete,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payloadJSON: Self.encode(payload),
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
        }
    }
}
