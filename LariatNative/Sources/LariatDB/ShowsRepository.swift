import Foundation
import GRDB
import LariatModel

/// Read layer over `shows` / `shows_archive` plus the Tonight · Live composed
/// read and the capacity-override write — behavior parity with
/// `lib/showsRepo.ts`, `GET /api/shows/tonight`, and
/// `POST /api/shows/[id]/capacity`. Callers pass `today` explicitly so tests
/// are deterministic (web contract). Reads are read-only; the one write
/// (capacity override on `shows.status_json`) is a single-key surgical
/// update audited via the FILE stream (`ShowsAuditLogger`, parity with
/// `logAuditAction`) inside the same transaction.
public struct ShowsRepository {
    private let readDB: LariatDatabase
    private let locationId: String

    public init(readDB: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.readDB = readDB
        self.locationId = locationId
    }

    // ── showsRepo.ts reads ────────────────────────────────────────────

    /// Upcoming shows inside `today .. today + weeks*7 days` (inclusive).
    public func upcomingShows(today: String, weeks: Int = 5) async throws -> [ShowRow] {
        let upper = Self.addDays(today, days: weeks * 7)
        let loc = locationId
        return try await readDB.pool.read { db in
            try ShowRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM shows
                   WHERE location_id = ?
                     AND show_date >= ?
                     AND show_date <= ?
                   ORDER BY show_date ASC, id ASC
                  """,
                arguments: [loc, today, upper]
            )
        }
    }

    /// Stage counts across the pipeline window INCLUDING unarchived past
    /// shows (so the past-show Settled rule can run) — parity with
    /// `pipelineCounts`.
    public func pipelineCounts(today: String, weeks: Int = 52) async throws -> [PipelineStage: Int] {
        let upper = Self.addDays(today, days: weeks * 7)
        let loc = locationId
        return try await readDB.pool.read { db in
            var counts: [PipelineStage: Int] = Dictionary(
                uniqueKeysWithValues: PipelineStage.allCases.map { ($0, 0) }
            )
            let rows = try ShowRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM shows
                   WHERE location_id = ?
                     AND show_date <= ?
                   ORDER BY show_date ASC, id ASC
                  """,
                arguments: [loc, upper]
            )
            for r in rows {
                let past = r.showDate < today
                let stage = ShowStatusCompute.pipelineStage(r.status, showIsPast: past)
                counts[stage, default: 0] += 1
            }
            return counts
        }
    }

    /// Archive search — band substring (`LIKE %q%`) and/or era filter,
    /// newest first.
    public func archiveSearch(q: String? = nil, era: Int? = nil) async throws -> [ShowsArchiveRow] {
        var clauses = ["location_id = ?"]
        var args: [DatabaseValueConvertible] = [locationId]
        if let q, !q.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            clauses.append("band_name LIKE ?")
            args.append("%\(q.trimmingCharacters(in: .whitespacesAndNewlines))%")
        }
        if let era {
            clauses.append("era_year = ?")
            args.append(era)
        }
        let sql = """
          SELECT id, band_name, show_date, era_year
            FROM shows_archive
           WHERE \(clauses.joined(separator: " AND "))
           ORDER BY show_date DESC, id DESC
          """
        let optionalArgs: [DatabaseValueConvertible?] = args
        let statementArgs = StatementArguments(optionalArgs)
        return try await readDB.pool.read { db in
            try ShowsArchiveRow.fetchAll(db, sql: sql, arguments: statementArgs)
        }
    }

    /// Distinct archive era years, newest first.
    public func archiveEras() async throws -> [Int] {
        let loc = locationId
        return try await readDB.pool.read { db in
            try Int.fetchAll(
                db,
                sql: """
                  SELECT DISTINCT era_year FROM shows_archive
                   WHERE location_id = ? AND era_year IS NOT NULL
                   ORDER BY era_year DESC
                  """,
                arguments: [loc]
            )
        }
    }

    public func getShowById(_ id: Int64) async throws -> ShowRow? {
        let loc = locationId
        return try await readDB.pool.read { db in
            try ShowRow.fetchOne(
                db,
                sql: "SELECT * FROM shows WHERE location_id = ? AND id = ?",
                arguments: [loc, id]
            )
        }
    }

    /// Soonest future show (or nil).
    public func nextUpcoming(today: String) async throws -> ShowRow? {
        let loc = locationId
        return try await readDB.pool.read { db in
            try ShowRow.fetchOne(
                db,
                sql: """
                  SELECT * FROM shows
                   WHERE location_id = ? AND show_date >= ?
                   ORDER BY show_date ASC, id ASC LIMIT 1
                  """,
                arguments: [loc, today]
            )
        }
    }

    /// Show-picker list for the per-show boards (native nicety — the web
    /// navigates from its own shows list): most recent first, bounded.
    public func recentShows(limit: Int = 60) async throws -> [ShowRow] {
        let loc = locationId
        let bounded = max(1, min(500, limit))
        return try await readDB.pool.read { db in
            try ShowRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM shows
                   WHERE location_id = ?
                   ORDER BY show_date DESC, id DESC LIMIT ?
                  """,
                arguments: [loc, bounded]
            )
        }
    }

    // ── Tonight · Live composed read (GET /api/shows/tonight) ─────────

    public struct PreviousShow: Sendable, Equatable {
        public let id: Int64
        public let bandName: String
        public let showDate: String
        public let price: Double?

        public init(id: Int64, bandName: String, showDate: String, price: Double?) {
            self.id = id
            self.bandName = bandName
            self.showDate = showDate
            self.price = price
        }
    }

    public struct TonightSnapshot: Sendable {
        public let locationId: String
        public let date: String
        public let show: ShowRow?
        public let showStatus: [String: ShowStatusValue]
        public let stageSetup: StageSetupRow?
        public let latestSoundScene: SoundSceneRow?
        public let boxOfficeSummary: TonightBoxOfficeSummary?
        public let attendance: Attendance?
        public let venueCapacity: Int?
        public let effectiveCapacity: Int?
        public let capacityOverride: Int?
        public let runOfShow: [TonightRunEntry]
        public let previousShow: PreviousShow?
        public let serverTime: String
    }

    /// Composed read of every per-show surface for `date` — read-only,
    /// parity with the tonight route field-for-field.
    public func tonightSnapshot(date: String) async throws -> TonightSnapshot {
        let loc = locationId
        return try await readDB.pool.read { db in
            let show = try ShowRow.fetchOne(
                db,
                sql: """
                  SELECT id, location_id, band_name, show_date, price, door_tix, status_json
                    FROM shows
                   WHERE location_id = ? AND show_date = ?
                   LIMIT 1
                  """,
                arguments: [loc, date]
            )

            let previousRow = try Row.fetchOne(
                db,
                sql: """
                  SELECT id, band_name, show_date, price
                    FROM shows
                   WHERE location_id = ? AND show_date < ?
                   ORDER BY show_date DESC
                   LIMIT 1
                  """,
                arguments: [loc, date]
            )
            let previous = previousRow.map {
                PreviousShow(id: $0["id"], bandName: $0["band_name"],
                             showDate: $0["show_date"], price: $0["price"])
            }

            // Venue capacity — locations.capacity (nullable, operator-set).
            let venueCapacity = try Int.fetchOne(
                db, sql: "SELECT capacity FROM locations WHERE id = ?", arguments: [loc]
            )

            let showStatus = show.map { ShowsTonightCompute.parseStatusJson($0.statusJson) } ?? [:]
            let effectiveCapacity = ShowsTonightCompute.pickEffectiveCapacity(
                showStatus, venueCapacity: venueCapacity.map(Double.init)
            )
            var capacityOverride: Int?
            if show != nil, let ov = showStatus["capacity"] {
                let n = ov.jsNumber
                if n.isFinite && n > 0 { capacityOverride = Int(n.rounded(.down)) }
            }

            var stageSetup: StageSetupRow?
            var latestScene: SoundSceneRow?
            var boxSummary: TonightBoxOfficeSummary?
            var attendance: Attendance?
            var runOfShow: [TonightRunEntry] = []

            if let show {
                stageSetup = try StageRepository.fetchSetup(db, showId: show.id, locationId: loc)
                latestScene = try SoundRepository.fetchLatestScene(db, showId: show.id, locationId: loc)

                let lines = try BoxOfficeLineRow.fetchAll(
                    db,
                    sql: """
                      SELECT id, show_id, location_id, source, ticket_class, qty,
                             face_price, fees, external_ref, scanned_at, notes, created_at
                        FROM box_office_lines
                       WHERE show_id = ? AND location_id = ?
                      """,
                    arguments: [show.id, loc]
                )
                let summary = ShowsTonightCompute.summarizeBoxOffice(lines)
                boxSummary = summary
                attendance = ShowsTonightCompute.computeAttendance(
                    scannedQty: summary.scannedQty,
                    soldQty: summary.totalQty,
                    capacity: effectiveCapacity.map(Double.init)
                )
                if let stageSetup {
                    // Web parity: the tonight route reads run_of_show_json RAW
                    // with its own {time,label} parser.
                    runOfShow = ShowsTonightCompute.parseRunOfShow(stageSetup.runOfShowJson)
                }
            }

            return TonightSnapshot(
                locationId: loc,
                date: date,
                show: show,
                showStatus: showStatus,
                stageSetup: stageSetup,
                latestSoundScene: latestScene,
                boxOfficeSummary: boxSummary,
                attendance: attendance,
                venueCapacity: venueCapacity,
                effectiveCapacity: effectiveCapacity,
                capacityOverride: capacityOverride,
                runOfShow: runOfShow,
                previousShow: previous,
                serverTime: ISO8601DateFormatter().string(from: Date())
            )
        }
    }

    // ── Capacity override write (POST /api/shows/[id]/capacity) ───────

    public static let maxCapacity = 5000

    public struct CapacityResult: Sendable, Equatable {
        public let showId: Int64
        public let capacity: Int?
        public let status: [String: ShowStatusValue]
    }

    /// Set or clear `shows.status_json.capacity`. Validation parity:
    /// nil → clear · non-finite → validation error · ≤0 → clear ·
    /// >5000 → validation error · else floor. Read-merge-write + file audit
    /// (`show_capacity_set`) in ONE transaction; audit failure rolls back.
    @discardableResult
    public func setCapacityOverride(
        showId: Int64,
        capacity: Double?,
        writeDB: LariatWriteDatabase,
        actorCookId: String?,
        auditLogger: ShowsAuditLogger = ShowsAuditLogger()
    ) throws -> CapacityResult {
        guard showId > 0 else {
            throw ShowsWriteError.validationFailed("Invalid show id")
        }
        let nextCapacity: Int?
        if let raw = capacity {
            guard raw.isFinite else {
                throw ShowsWriteError.validationFailed("capacity must be a finite number or null")
            }
            if raw <= 0 {
                nextCapacity = nil   // 0 / negative deletes the override
            } else if raw > Double(Self.maxCapacity) {
                throw ShowsWriteError.validationFailed("capacity must be <= \(Self.maxCapacity)")
            } else {
                nextCapacity = Int(raw.rounded(.down))
            }
        } else {
            nextCapacity = nil
        }

        let loc = locationId
        return try AuditedWriteRunner.perform(db: writeDB) { db in
            let rawJson = try String.fetchOne(
                db,
                sql: "SELECT status_json FROM shows WHERE id = ? AND location_id = ?",
                arguments: [showId, loc]
            )
            guard let rawJson else { throw ShowsWriteError.notFound }

            var status = ShowsTonightCompute.parseStatusJson(rawJson)
            if let nextCapacity {
                status["capacity"] = .number(Double(nextCapacity))
            } else {
                status.removeValue(forKey: "capacity")
            }
            let nextJson = Self.serializeStatus(status)
            try db.execute(
                sql: "UPDATE shows SET status_json = ? WHERE id = ? AND location_id = ?",
                arguments: [nextJson, showId, loc]
            )
            try auditLogger.log(action: "show_capacity_set", fields: [
                "show_id": showId,
                "location_id": loc,
                "capacity": nextCapacity,
                "actor_cook_id": actorCookId,
            ])
            return CapacityResult(showId: showId, capacity: nextCapacity, status: status)
        }
    }

    // ── helpers ───────────────────────────────────────────────────────

    /// UTC calendar-day addition on an ISO date — parity with `addDays`.
    public static func addDays(_ iso: String, days: Int) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.locale = Locale(identifier: "en_US_POSIX")
        guard let d = fmt.date(from: iso) else { return iso }
        let shifted = d.addingTimeInterval(TimeInterval(days) * 86_400)
        return fmt.string(from: shifted)
    }

    /// Serialize a parsed status back to JSON (web `JSON.stringify(status)`).
    static func serializeStatus(_ status: [String: ShowStatusValue]) -> String {
        let any = status.mapValues { $0.toAny() }
        guard let data = try? JSONSerialization.data(withJSONObject: any, options: [.sortedKeys]),
              let s = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return s
    }
}
