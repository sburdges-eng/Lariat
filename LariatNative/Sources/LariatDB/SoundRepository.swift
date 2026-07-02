import Foundation
import GRDB
import LariatModel

/// Sound scenes + SPL telemetry — behavior parity with `lib/soundRepo.ts` and
/// the `/api/shows/[id]/sound{,/[sceneId],/spl}` routes. Operational data
/// (not regulated cash custody) — audited via the FILE stream
/// (`ShowsAuditLogger`, parity with `logAuditAction`) INSIDE the same write
/// transaction, so an audit failure rolls the mutation back.
public struct SoundRepository {
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

    public func listScenes(showId: Int64) async throws -> [SoundSceneRow] {
        let loc = locationId
        return try await readDB.pool.read { db in
            try Self.fetchScenes(db, showId: showId, locationId: loc)
        }
    }

    public func latestScene(showId: Int64) async throws -> SoundSceneRow? {
        let loc = locationId
        return try await readDB.pool.read { db in
            try Self.fetchLatestScene(db, showId: showId, locationId: loc)
        }
    }

    /// Readings ordered oldest → newest (DESC + LIMIT bounded, then
    /// reversed) — parity with `listSplReadings`.
    public func listSplReadings(
        showId: Int64,
        sinceIso: String? = nil,
        limit: Int? = nil
    ) async throws -> [SplReadingRow] {
        let loc = locationId
        let bounded = max(1, min(2000, limit ?? 200))
        let since = sinceIso?.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await readDB.pool.read { db in
            let rows: [SplReadingRow]
            if let since, !since.isEmpty {
                rows = try SplReadingRow.fetchAll(
                    db,
                    sql: """
                      SELECT * FROM spl_readings
                       WHERE show_id = ? AND location_id = ? AND taken_at >= ?
                       ORDER BY datetime(taken_at) DESC, id DESC
                       LIMIT ?
                      """,
                    arguments: [showId, loc, since, bounded]
                )
            } else {
                rows = try SplReadingRow.fetchAll(
                    db,
                    sql: """
                      SELECT * FROM spl_readings
                       WHERE show_id = ? AND location_id = ?
                       ORDER BY datetime(taken_at) DESC, id DESC
                       LIMIT ?
                      """,
                    arguments: [showId, loc, bounded]
                )
            }
            return rows.reversed()
        }
    }

    // ── Writes ────────────────────────────────────────────────────────

    public struct CreateSceneInput: Sendable {
        public let showId: Int64
        public let sceneName: String
        public let plot: SoundPlot
        public let splLimitDb: Double?
        public let notes: String?
        public let savedByCookId: String?

        public init(
            showId: Int64, sceneName: String, plot: SoundPlot,
            splLimitDb: Double? = nil, notes: String? = nil, savedByCookId: String? = nil
        ) {
            self.showId = showId
            self.sceneName = sceneName
            self.plot = plot
            self.splLimitDb = splLimitDb
            self.notes = notes
            self.savedByCookId = savedByCookId
        }
    }

    @discardableResult
    public func createScene(_ input: CreateSceneInput) throws -> SoundSceneRow {
        guard input.showId > 0 else {
            throw ShowsWriteError.validationFailed("show_id must be a positive integer")
        }
        let name = input.sceneName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            throw ShowsWriteError.validationFailed("scene_name is required")
        }
        let writeDB = try requireWriteDB()
        // Route parity: notes clipped to 4000 chars.
        let notes = input.notes.map { String($0.prefix(4000)) }
        let loc = locationId
        let logger = auditLogger

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO sound_scenes
                    (show_id, location_id, scene_name, plot_json, spl_limit_db, notes, saved_by_cook_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    input.showId, loc, name, input.plot.toJSON(),
                    input.splLimitDb, notes, input.savedByCookId,
                ]
            )
            let id = db.lastInsertedRowID
            guard let row = try Self.fetchScene(db, id: id) else {
                throw ShowsWriteError.persistenceFailed
            }
            try logger.log(action: "sound_scene_created", fields: [
                "show_id": input.showId,
                "location_id": loc,
                "scene_name": row.sceneName,
                "saved_by_cook_id": input.savedByCookId,
            ])
            return row
        }
    }

    /// Partial update. `setSplLimitDb` / `setNotes` distinguish "leave
    /// unchanged" from "set to null" (the JS undefined/null split).
    public struct ScenePatch: Sendable {
        public var sceneName: String?
        public var plot: SoundPlot?
        public var setSplLimitDb = false
        public var splLimitDb: Double?
        public var setNotes = false
        public var notes: String?
        public var savedByCookId: String?

        public init(
            sceneName: String? = nil, plot: SoundPlot? = nil,
            setSplLimitDb: Bool = false, splLimitDb: Double? = nil,
            setNotes: Bool = false, notes: String? = nil,
            savedByCookId: String? = nil
        ) {
            self.sceneName = sceneName
            self.plot = plot
            self.setSplLimitDb = setSplLimitDb
            self.splLimitDb = splLimitDb
            self.setNotes = setNotes
            self.notes = notes
            self.savedByCookId = savedByCookId
        }

        var isEmpty: Bool {
            sceneName == nil && plot == nil && !setSplLimitDb && !setNotes && savedByCookId == nil
        }
    }

    @discardableResult
    public func updateScene(id: Int64, patch: ScenePatch) throws -> SoundSceneRow {
        guard id > 0 else {
            throw ShowsWriteError.validationFailed("id must be a positive integer")
        }
        if let name = patch.sceneName, name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw ShowsWriteError.validationFailed("scene_name cannot be empty")
        }
        guard !patch.isEmpty else {
            throw ShowsWriteError.validationFailed("No patch fields supplied")
        }
        let writeDB = try requireWriteDB()
        let loc = locationId
        let logger = auditLogger

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            guard let existing = try Self.fetchScene(db, id: id, locationId: loc) else {
                throw ShowsWriteError.notFound
            }
            let nextName = patch.sceneName.map {
                $0.trimmingCharacters(in: .whitespacesAndNewlines)
            } ?? existing.sceneName
            let nextPlotJson: String
            if let plot = patch.plot {
                nextPlotJson = plot.toJSON()
            } else {
                nextPlotJson = try String.fetchOne(
                    db, sql: "SELECT plot_json FROM sound_scenes WHERE id = ?", arguments: [id]
                ) ?? "{}"
            }
            let nextSpl = patch.setSplLimitDb ? patch.splLimitDb : existing.splLimitDb
            // Route parity: notes clipped to 4000 chars.
            let nextNotes = patch.setNotes ? patch.notes.map { String($0.prefix(4000)) } : existing.notes
            let nextSavedBy = patch.savedByCookId ?? existing.savedByCookId

            try db.execute(
                sql: """
                  UPDATE sound_scenes
                     SET scene_name = ?, plot_json = ?, spl_limit_db = ?, notes = ?,
                         saved_by_cook_id = ?, saved_at = datetime('now')
                   WHERE id = ? AND location_id = ?
                  """,
                arguments: [nextName, nextPlotJson, nextSpl, nextNotes, nextSavedBy, id, loc]
            )
            guard let row = try Self.fetchScene(db, id: id) else {
                throw ShowsWriteError.persistenceFailed
            }
            try logger.log(action: "sound_scene_updated", fields: [
                "scene_id": id,
                "show_id": row.showId,
                "location_id": loc,
                "scene_name": row.sceneName,
                "saved_by_cook_id": nextSavedBy,
            ])
            return row
        }
    }

    @discardableResult
    public func deleteScene(id: Int64) throws -> Bool {
        guard id > 0 else {
            throw ShowsWriteError.validationFailed("id must be a positive integer")
        }
        let writeDB = try requireWriteDB()
        let loc = locationId
        let logger = auditLogger

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            let existing = try Row.fetchOne(
                db,
                sql: "SELECT id, show_id, scene_name FROM sound_scenes WHERE id = ? AND location_id = ?",
                arguments: [id, loc]
            )
            guard let existing else { throw ShowsWriteError.notFound }
            try db.execute(
                sql: "DELETE FROM sound_scenes WHERE id = ? AND location_id = ?",
                arguments: [id, loc]
            )
            try logger.log(action: "sound_scene_deleted", fields: [
                "scene_id": id,
                "show_id": existing["show_id"] as Int64,
                "location_id": loc,
                "scene_name": existing["scene_name"] as String,
            ])
            return true
        }
    }

    // ── SPL telemetry (append-only) ───────────────────────────────────

    public static let splMinDb = 30.0
    public static let splMaxDb = 160.0

    public struct AppendSplInput: Sendable {
        public let showId: Int64
        public let sceneId: Int64?
        public let dbValue: Double
        public let takenByCookId: String?
        public let notes: String?

        public init(
            showId: Int64, sceneId: Int64? = nil, dbValue: Double,
            takenByCookId: String? = nil, notes: String? = nil
        ) {
            self.showId = showId
            self.sceneId = sceneId
            self.dbValue = dbValue
            self.takenByCookId = takenByCookId
            self.notes = notes
        }
    }

    @discardableResult
    public func appendSplReading(_ input: AppendSplInput) throws -> SplReadingRow {
        guard input.showId > 0 else {
            throw ShowsWriteError.validationFailed("show_id must be a positive integer")
        }
        guard input.dbValue.isFinite,
              input.dbValue >= Self.splMinDb, input.dbValue <= Self.splMaxDb else {
            throw ShowsWriteError.validationFailed(
                "db_value must be a finite number in [\(Int(Self.splMinDb)), \(Int(Self.splMaxDb))]"
            )
        }
        // Invalid scene ids coerce to nil (web parity).
        let sceneId: Int64? = (input.sceneId ?? 0) > 0 ? input.sceneId : nil
        // Route parity: notes clipped to 2000 chars.
        let notes = input.notes.map { String($0.prefix(2000)) }
        let writeDB = try requireWriteDB()
        let loc = locationId
        let logger = auditLogger

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO spl_readings
                    (show_id, location_id, scene_id, db_value, taken_by_cook_id, notes)
                  VALUES (?, ?, ?, ?, ?, ?)
                  """,
                arguments: [input.showId, loc, sceneId, input.dbValue, input.takenByCookId, notes]
            )
            let id = db.lastInsertedRowID
            guard let row = try SplReadingRow.fetchOne(
                db, sql: "SELECT * FROM spl_readings WHERE id = ?", arguments: [id]
            ) else {
                throw ShowsWriteError.persistenceFailed
            }
            try logger.log(action: "spl_reading_added", fields: [
                "show_id": input.showId,
                "location_id": loc,
                "scene_id": sceneId,
                "db_value": input.dbValue,
                "taken_by_cook_id": input.takenByCookId,
            ])
            return row
        }
    }

    // ── Row mapping (shared with the tonight snapshot) ────────────────

    static func fetchScenes(_ db: Database, showId: Int64, locationId: String) throws -> [SoundSceneRow] {
        let rows = try Row.fetchAll(
            db,
            sql: """
              SELECT * FROM sound_scenes
               WHERE show_id = ? AND location_id = ?
               ORDER BY saved_at DESC, id DESC
              """,
            arguments: [showId, locationId]
        )
        return rows.map(sceneRow(from:))
    }

    static func fetchLatestScene(_ db: Database, showId: Int64, locationId: String) throws -> SoundSceneRow? {
        let row = try Row.fetchOne(
            db,
            sql: """
              SELECT * FROM sound_scenes
               WHERE show_id = ? AND location_id = ?
               ORDER BY datetime(saved_at) DESC, id DESC
               LIMIT 1
              """,
            arguments: [showId, locationId]
        )
        return row.map(sceneRow(from:))
    }

    static func fetchScene(_ db: Database, id: Int64, locationId: String? = nil) throws -> SoundSceneRow? {
        let row: Row?
        if let locationId {
            row = try Row.fetchOne(
                db, sql: "SELECT * FROM sound_scenes WHERE id = ? AND location_id = ?",
                arguments: [id, locationId]
            )
        } else {
            row = try Row.fetchOne(
                db, sql: "SELECT * FROM sound_scenes WHERE id = ?", arguments: [id]
            )
        }
        return row.map(sceneRow(from:))
    }

    static func sceneRow(from row: Row) -> SoundSceneRow {
        SoundSceneRow(
            id: row["id"],
            showId: row["show_id"],
            locationId: row["location_id"],
            sceneName: row["scene_name"],
            plot: SoundPlot.parse(row["plot_json"]),
            splLimitDb: row["spl_limit_db"],
            notes: row["notes"],
            savedByCookId: row["saved_by_cook_id"],
            savedAt: row["saved_at"]
        )
    }

    private func requireWriteDB() throws -> LariatWriteDatabase {
        guard let writeDB else {
            throw ShowsWriteError.persistenceFailed
        }
        return writeDB
    }
}
