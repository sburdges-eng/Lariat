import Foundation
import GRDB
import LariatModel

/// Read-only booking-board queries — ports the three `lib/showsRepo.ts`
/// functions `/booking` consumes (`upcomingShows`, `pipelineCounts`,
/// `nextUpcoming`). No writes; `archiveSearch`/`getShowById` belong to the
/// /shows + /playbook surfaces (other waves).
public struct BookingRepository: Sendable {
    private let database: LariatDatabase
    private let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    /// The /booking page bundle: 5-week calendar + 52-week pipeline counts
    /// + next upcoming show, all pinned to one `today`.
    public func loadBoard(today: String = ShiftDate.todayISO()) async throws -> BookingBoardSnapshot {
        async let upcoming = upcomingShows(today: today, weeks: 5)
        async let counts = pipelineCounts(today: today, weeks: 52)
        async let next = nextUpcoming(today: today)
        return try await BookingBoardSnapshot(
            upcoming: upcoming, pipelineCounts: counts, next: next
        )
    }

    /// upcomingShows — confirmed rows inside `[today, today + weeks*7d]`.
    public func upcomingShows(today: String, weeks: Int = 5) async throws -> [BookingShowRow] {
        let upper = Self.addDays(today, days: weeks * 7)
        return try await database.pool.read { [locationId] db in
            try BookingShowRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM shows
                   WHERE location_id = ?
                     AND show_date >= ?
                     AND show_date <= ?
                   ORDER BY show_date ASC, id ASC
                  """,
                arguments: [locationId, today, upper]
            )
        }
    }

    /// pipelineCounts — active rows through the pipeline window, INCLUDING
    /// unarchived past shows, so the past-show Settled rule can run.
    /// Every known stage is present in the result (zero-filled).
    public func pipelineCounts(today: String, weeks: Int = 52) async throws -> [String: Int] {
        let upper = Self.addDays(today, days: weeks * 7)
        let rows = try await database.pool.read { [locationId] db in
            try BookingShowRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM shows
                   WHERE location_id = ?
                     AND show_date <= ?
                   ORDER BY show_date ASC, id ASC
                  """,
                arguments: [locationId, upper]
            )
        }
        var counts: [String: Int] = [:]
        for stage in ShowPipelineCompute.knownStages { counts[stage] = 0 }
        for row in rows {
            let past = row.showDate < today
            let stage = ShowPipelineCompute.pipelineStage(row.status, showIsPast: past)
            counts[stage, default: 0] += 1
        }
        return counts
    }

    /// nextUpcoming — soonest show on/after `today`, or nil.
    public func nextUpcoming(today: String) async throws -> BookingShowRow? {
        try await database.pool.read { [locationId] db in
            try BookingShowRow.fetchOne(
                db,
                sql: """
                  SELECT * FROM shows
                   WHERE location_id = ? AND show_date >= ?
                   ORDER BY show_date ASC, id ASC LIMIT 1
                  """,
                arguments: [locationId, today]
            )
        }
    }

    /// `addDays` in lib/showsRepo.ts — UTC date math on ISO dates.
    static func addDays(_ iso: String, days: Int) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: iso) else { return iso }
        let shifted = date.addingTimeInterval(TimeInterval(days) * 86_400)
        return f.string(from: shifted)
    }
}
