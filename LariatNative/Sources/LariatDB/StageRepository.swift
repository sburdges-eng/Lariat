import Foundation
import GRDB
import LariatModel

/// Stage setups — behavior parity with `lib/stageRepo.ts` and
/// `/api/shows/[id]/stage`. One row per (show_id, location_id), UPSERTed.
/// Soft-state config edits — audited via the FILE stream (`ShowsAuditLogger`)
/// INSIDE the same write transaction (the cash-custody box-office side uses
/// the `audit_events` DB stream instead).
public struct StageRepository {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let locationId: String
    private let auditLogger: ShowsAuditLogger

    public init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase? = nil,
        locationId: String = LocationScope.resolve(),
        auditLogger: ShowsAuditLogger? = nil
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.locationId = locationId
        self.auditLogger = auditLogger ?? ShowsAuditLogger()
    }

    // ── Reads ─────────────────────────────────────────────────────────

    public func getSetup(showId: Int64) async throws -> StageSetupRow? {
        let loc = locationId
        return try await readDB.pool.read { db in
            try Self.fetchSetup(db, showId: showId, locationId: loc)
        }
    }

    // ── Writes ────────────────────────────────────────────────────────

    public struct UpsertInput: Sendable {
        public let showId: Int64
        public let roomConfig: String
        public let runOfShow: [RunOfShowEntry]
        public let hospitalityRiderJson: String
        public let techRiderJson: String
        public let notes: String?
        public let actorCookId: String?

        public init(
            showId: Int64, roomConfig: String,
            runOfShow: [RunOfShowEntry] = [],
            hospitalityRiderJson: String = "{}",
            techRiderJson: String = "{}",
            notes: String? = nil,
            actorCookId: String? = nil
        ) {
            self.showId = showId
            self.roomConfig = roomConfig
            self.runOfShow = runOfShow
            self.hospitalityRiderJson = hospitalityRiderJson
            self.techRiderJson = techRiderJson
            self.notes = notes
            self.actorCookId = actorCookId
        }
    }

    public struct UpsertResult: Sendable {
        public let setup: StageSetupRow
        public let created: Bool
    }

    /// UPSERT by (show_id, location_id). Unknown `room_config` values throw
    /// BEFORE the transaction (web 400); the audit line shares the tx.
    @discardableResult
    public func upsertSetup(_ input: UpsertInput) throws -> UpsertResult {
        guard StageRoomCatalog.isKnownRoomConfig(input.roomConfig) else {
            throw ShowsWriteError.validationFailed("unknown room_config: \(input.roomConfig)")
        }
        guard input.showId > 0 else {
            throw ShowsWriteError.validationFailed("show_id must be a positive integer")
        }
        let writeDB = try requireWriteDB()
        let ros = RunOfShowEntry.toJSON(input.runOfShow)
        // Rider blobs must be JSON objects; malformed input degrades to {}
        // (the web route coerces non-object bodies to {} before the repo).
        let hr = Self.normalizeRiderJson(input.hospitalityRiderJson)
        let tr = Self.normalizeRiderJson(input.techRiderJson)
        // Route parity: notes clipped to 4000 chars.
        let notes = input.notes.map { String($0.prefix(4000)) }
        let loc = locationId
        let logger = auditLogger

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            let existingId = try Int64.fetchOne(
                db,
                sql: "SELECT id FROM stage_setups WHERE show_id = ? AND location_id = ?",
                arguments: [input.showId, loc]
            )

            if let existingId {
                try db.execute(
                    sql: """
                      UPDATE stage_setups
                         SET room_config = ?,
                             run_of_show_json = ?,
                             hospitality_rider_json = ?,
                             tech_rider_json = ?,
                             notes = ?,
                             updated_at = datetime('now')
                       WHERE id = ?
                      """,
                    arguments: [input.roomConfig, ros, hr, tr, notes, existingId]
                )
                try logger.log(action: "stage_setup_updated", fields: [
                    "show_id": input.showId,
                    "location_id": loc,
                    "room_config": input.roomConfig,
                    "actor_cook_id": input.actorCookId,
                ])
                guard let setup = try Self.fetchSetup(db, showId: input.showId, locationId: loc) else {
                    throw ShowsWriteError.persistenceFailed
                }
                return UpsertResult(setup: setup, created: false)
            }

            try db.execute(
                sql: """
                  INSERT INTO stage_setups
                    (show_id, location_id, room_config,
                     run_of_show_json, hospitality_rider_json, tech_rider_json, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [input.showId, loc, input.roomConfig, ros, hr, tr, notes]
            )
            try logger.log(action: "stage_setup_created", fields: [
                "show_id": input.showId,
                "location_id": loc,
                "room_config": input.roomConfig,
                "actor_cook_id": input.actorCookId,
            ])
            guard let setup = try Self.fetchSetup(db, showId: input.showId, locationId: loc) else {
                throw ShowsWriteError.persistenceFailed
            }
            return UpsertResult(setup: setup, created: true)
        }
    }

    // ── Row mapping (shared with the tonight snapshot) ────────────────

    static func fetchSetup(_ db: Database, showId: Int64, locationId: String) throws -> StageSetupRow? {
        let row = try Row.fetchOne(
            db,
            sql: "SELECT * FROM stage_setups WHERE show_id = ? AND location_id = ?",
            arguments: [showId, locationId]
        )
        return row.map { r in
            StageSetupRow(
                id: r["id"],
                showId: r["show_id"],
                locationId: r["location_id"],
                roomConfig: r["room_config"],
                runOfShow: RunOfShowEntry.parseList(r["run_of_show_json"]),
                runOfShowJson: r["run_of_show_json"] ?? "[]",
                hospitalityRiderJson: r["hospitality_rider_json"] ?? "{}",
                techRiderJson: r["tech_rider_json"] ?? "{}",
                notes: r["notes"],
                createdAt: r["created_at"],
                updatedAt: r["updated_at"]
            )
        }
    }

    /// Keep rider blobs as JSON objects; anything unparseable becomes `{}`.
    static func normalizeRiderJson(_ raw: String) -> String {
        guard let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              parsed is [String: Any] else {
            return "{}"
        }
        return raw
    }

    private func requireWriteDB() throws -> LariatWriteDatabase {
        guard let writeDB else {
            throw ShowsWriteError.persistenceFailed
        }
        return writeDB
    }
}
