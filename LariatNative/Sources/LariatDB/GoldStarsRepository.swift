import Foundation
import GRDB
import LariatModel

/// Repository for /gold-stars (A6.2) — behavior parity with
/// `app/api/gold-stars/route.ts` + `app/api/gold-stars/[id]/route.ts`.
///
/// Reads are open (the board GET stays open for cooks). BOTH writes are
/// PIN-gated on the web (`requirePin` — "awarding a star is manager
/// authority, same as removing one"); natively the app layer gates them
/// with `PinEntrySheet` + `ManagementWrite.requireSession` and passes a
/// `RegulatedWriteContext.nativeMac` here. HR/personal data — every write
/// runs in ONE transaction with its `audit_events` row (`AuditedWriteRunner`
/// + `AuditEventWriter`, parity with the routes' `db.transaction` +
/// `postAuditEvent`).
///
/// actor_source: `native_mac` (program convention for PIN-gated writes;
/// the web posts 'api' on insert / 'manager_pin' on delete — documented
/// divergence). The `gold_stars.deleted_by` COLUMN keeps the web literal
/// `'manager_pin'` for row parity. No idempotency: a second delete of the
/// same star throws `.notFound`, exactly like the route's 404.
public struct GoldStarsRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET /api/gold-stars — the BOARD feed: today's stars only ────────
    // The recognition wall resets every day by design — yesterday's stars
    // leave the board but are never deleted. "Today" is the venue's local
    // day (created_at in localtime), so a star given during evening service
    // doesn't vanish at the UTC rollover.

    public func board(
        locationId: String = LocationScope.resolve()
    ) async throws -> [GoldStarRow] {
        try await readDB.pool.read { db in
            try GoldStarRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM gold_stars
                   WHERE location_id = ?
                     AND deleted_at IS NULL
                     AND date(created_at, 'localtime') = date('now', 'localtime')
                   ORDER BY id DESC
                   LIMIT 50
                  """,
                arguments: [locationId]
            )
        }
    }

    // ── GET ?view=leaderboard — the permanent per-employee record ───────

    public func leaderboard(
        locationId: String = LocationScope.resolve()
    ) async throws -> [GoldStarLeaderboardRow] {
        try await readDB.pool.read { db in
            try GoldStarLeaderboardRow.fetchAll(
                db,
                sql: """
                  SELECT cook_name,
                         SUM(stars)        AS total_stars,
                         COUNT(*)          AS awards,
                         MAX(awarded_date) AS last_awarded
                    FROM gold_stars
                   WHERE location_id = ?
                     AND deleted_at IS NULL
                   GROUP BY cook_name
                   ORDER BY total_stars DESC, cook_name ASC
                  """,
                arguments: [locationId]
            )
        }
    }

    // ── POST /api/gold-stars (award) ────────────────────────────────────

    @discardableResult
    public func award(
        cookName: String,
        reason: String,
        stars: Int?,
        context: RegulatedWriteContext
    ) throws -> Int64 {
        let cook = cookName.trimmingCharacters(in: .whitespacesAndNewlines)
        let reasonText = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cook.isEmpty, !reasonText.isEmpty else {
            throw GoldStarWriteError.cookAndReasonRequired
        }
        let parsedStars = GoldStarCompute.clampStars(stars)
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: "INSERT INTO gold_stars (cook_name, reason, stars, location_id) VALUES (?, ?, ?, ?)",
                arguments: [cook, reasonText, parsedStars, locationId]
            )
            let id = db.lastInsertedRowID
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "gold_stars",
                    entityId: id,
                    action: .insert,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payload: [
                        "cook_name": cook,
                        "reason": reasonText,
                        "stars": String(parsedStars),
                    ],
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
            return id
        }
    }

    // ── DELETE /api/gold-stars/[id] (soft delete) ───────────────────────

    public func remove(id: Int64, context: RegulatedWriteContext) throws {
        guard id > 0 else { throw GoldStarWriteError.invalidId }
        let locationId = context.locationId

        try AuditedWriteRunner.perform(db: writeDB) { db in
            let row = try Row.fetchOne(
                db,
                sql: """
                  SELECT id, cook_name, reason, stars, awarded_date, location_id, deleted_at
                    FROM gold_stars
                   WHERE id = ? AND location_id = ?
                  """,
                arguments: [id, locationId]
            )
            guard let row, (row["deleted_at"] as String?) == nil else {
                throw GoldStarWriteError.notFound
            }

            try db.execute(
                sql: """
                  UPDATE gold_stars
                     SET deleted_at = datetime('now'),
                         deleted_by = 'manager_pin'
                   WHERE id = ? AND location_id = ? AND deleted_at IS NULL
                  """,
                arguments: [id, locationId]
            )

            let stars: Int? = row["stars"]
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "gold_stars",
                    entityId: id,
                    action: .delete,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payload: [
                        "cook_name": row["cook_name"] ?? "",
                        "reason": row["reason"] ?? "",
                        "stars": stars.map(String.init) ?? "",
                        "awarded_date": row["awarded_date"] ?? "",
                    ],
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
        }
    }
}
