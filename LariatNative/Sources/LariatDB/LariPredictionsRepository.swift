import Foundation
import GRDB
import LariatModel

/// Port of GET /api/lari/predictions (`app/api/lari/predictions/route.js`) —
/// the ambient-strip data layer for the beo / sound / host surfaces.
///
/// The web route is PIN-gated via `requirePin()`; natively the app layer gates
/// (GoldStars precedent — repository runs post-gate). Unknown surfaces return
/// an empty list + note, never an error (consumer ships a generic loader).
public struct LariPredictionsRepository {
    public struct Feed: Sendable, Equatable {
        public let surface: String
        public let locationId: String
        public let date: String
        public let predictions: [LariPrediction]
        public let note: String?
        public let showId: Int64?

        public init(
            surface: String, locationId: String, date: String,
            predictions: [LariPrediction], note: String? = nil, showId: Int64? = nil
        ) {
            self.surface = surface
            self.locationId = locationId
            self.date = date
            self.predictions = predictions
            self.note = note
            self.showId = showId
        }
    }

    public struct BadRequest: Error, Equatable, LocalizedError {
        public let message: String

        public init(_ message: String) {
            self.message = message
        }

        public var errorDescription: String? { message }
    }

    public static let supportedSurfaces: Set<String> = ["beo", "sound", "host"]

    private let readDB: LariatDatabase

    public init(readDB: LariatDatabase) {
        self.readDB = readDB
    }

    public func feed(
        surface: String = "beo",
        locationId: String = LocationScope.resolve(),
        date: String = ShiftDate.todayISO(),
        showId: Int64? = nil,
        nowIso: String = LariConversationMemoryCompute.isoString()
    ) throws -> Feed {
        guard Self.supportedSurfaces.contains(surface) else {
            return Feed(
                surface: surface, locationId: locationId, date: date, predictions: [],
                note: "Surface \"\(surface)\" has no LaRi handler yet."
            )
        }

        switch surface {
        case "host":
            return try hostFeed(locationId: locationId, date: date, nowIso: nowIso)
        case "sound":
            guard let showId, showId > 0 else {
                throw BadRequest("show_id query param required for surface=sound")
            }
            return try soundFeed(locationId: locationId, date: date, showId: showId)
        default:
            return try beoFeed(locationId: locationId, date: date)
        }
    }

    private func hostFeed(locationId: String, date: String, nowIso: String) throws -> Feed {
        let parties = try readDB.pool.read { db in
            try WaitlistPartyRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM waitlist_parties
                   WHERE location_id = ?
                     AND (status = 'waiting'
                          OR (status = 'seated' AND substr(seated_at, 1, 10) = ?)
                          OR (status = 'left'   AND substr(left_at,   1, 10) = ?))
                  """,
                arguments: [locationId, date, date]
            )
        }
        let summary = HostStandCompute.summarizeWaitlist(parties, nowIso: nowIso)
        let predictions = LariPredictionsCompute.buildHostPredictions(
            summary: LariPredictionsCompute.HostWaitlistSummaryInput(
                total: summary.total,
                waiting: summary.waiting,
                seatedToday: summary.seatedToday,
                leftToday: summary.leftToday,
                avgWaitMinutes: summary.avgWaitMinutes.map(Double.init),
                longestWaitMinutes: summary.longestWaitMinutes.map(Double.init),
                longestWaitPartyId: summary.longestWaitPartyId
            ),
            today: date
        )
        return Feed(surface: "host", locationId: locationId, date: date, predictions: predictions)
    }

    private func soundFeed(locationId: String, date: String, showId: Int64) throws -> Feed {
        struct ShowRow { let id: Int64; let bandName: String? }
        let (show, scenes, readings) = try readDB.pool.read { db -> (ShowRow?, [Row], [Row]) in
            guard let showRow = try Row.fetchOne(
                db,
                sql: "SELECT id, band_name FROM shows WHERE id = ? AND location_id = ?",
                arguments: [showId, locationId]
            ) else { return (nil, [], []) }
            let scenes = try Row.fetchAll(
                db,
                sql: """
                  SELECT * FROM sound_scenes
                   WHERE show_id = ? AND location_id = ?
                   ORDER BY saved_at DESC, id DESC
                  """,
                arguments: [showId, locationId]
            )
            let readings = try Row.fetchAll(
                db,
                sql: """
                  SELECT * FROM spl_readings
                   WHERE show_id = ? AND location_id = ?
                   ORDER BY datetime(taken_at) DESC, id DESC
                   LIMIT 200
                  """,
                arguments: [showId, locationId]
            )
            return (ShowRow(id: showRow["id"], bandName: showRow["band_name"]), scenes, readings.reversed())
        }
        guard let show else {
            return Feed(
                surface: "sound", locationId: locationId, date: date, predictions: [],
                note: "Show \(showId) not found at location \(locationId).", showId: showId
            )
        }

        let sceneInputs: [LariPredictionsCompute.SoundSceneInput] = scenes.map { row in
            // channels count from the plot JSON — the compute only needs the count.
            var channelCount: Int? = nil
            if let plotJSON = row["plot_json"] as String?,
               let data = plotJSON.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                channelCount = (parsed["channels"] as? [Any])?.count ?? 0
            }
            return LariPredictionsCompute.SoundSceneInput(
                id: row["id"],
                sceneName: row["scene_name"] ?? "",
                splLimitDb: row["spl_limit_db"],
                plotChannelCount: channelCount,
                savedAt: row["saved_at"] ?? ""
            )
        }
        let readingRows: [SplReadingRow] = try readings.map { try SplReadingRow(row: $0) }
        let latestSceneLimit = sceneInputs.first?.splLimitDb
        let summary = SplTelemetryCompute.summarizeSpl(readingRows, limit: latestSceneLimit)

        let predictions = LariPredictionsCompute.buildSoundPredictions(
            showId: showId,
            bandName: show.bandName,
            scenes: sceneInputs,
            splSummary: LariPredictionsCompute.SplSummaryInput(
                count: summary.count,
                latest: summary.latest,
                peak: summary.peak,
                overLimitCount: summary.overLimitCount,
                limitDb: summary.limitDb
            ),
            today: date
        )
        return Feed(surface: "sound", locationId: locationId, date: date, predictions: predictions, showId: showId)
    }

    private func beoFeed(locationId: String, date: String) throws -> Feed {
        let (events, lineItems, prepTasks) = try readDB.pool.read { db -> (
            [LariPredictionsCompute.BeoEventRow],
            [LariPredictionsCompute.BeoLineItemRow],
            [LariPredictionsCompute.BeoPrepTaskRow]
        ) in
            let events = try Row.fetchAll(
                db,
                sql: """
                  SELECT id, title, event_date, event_time, contact_name, guest_count, notes
                    FROM beo_events
                   WHERE location_id = ?
                     AND (event_date IS NULL OR event_date >= ?)
                   ORDER BY event_date, id
                  """,
                arguments: [locationId, date]
            ).map {
                LariPredictionsCompute.BeoEventRow(
                    id: $0["id"], title: $0["title"], eventDate: $0["event_date"],
                    eventTime: $0["event_time"], contactName: $0["contact_name"],
                    guestCount: $0["guest_count"], notes: $0["notes"]
                )
            }
            guard !events.isEmpty else { return (events, [], []) }
            let lineItems = try Row.fetchAll(
                db,
                sql: """
                  SELECT id, event_id, item_name, quantity
                    FROM beo_line_items
                   WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
                  """,
                arguments: [locationId]
            ).map {
                LariPredictionsCompute.BeoLineItemRow(
                    id: $0["id"], eventId: $0["event_id"], itemName: $0["item_name"], quantity: $0["quantity"]
                )
            }
            let prepTasks = try Row.fetchAll(
                db,
                sql: "SELECT id, event_id, task, due_date, done FROM beo_prep_tasks WHERE location_id = ?",
                arguments: [locationId]
            ).map {
                LariPredictionsCompute.BeoPrepTaskRow(
                    id: $0["id"], eventId: $0["event_id"], task: $0["task"],
                    dueDate: $0["due_date"], done: $0["done"] ?? 0
                )
            }
            return (events, lineItems, prepTasks)
        }

        let predictions = LariPredictionsCompute.buildBeoPredictions(
            events: events, lineItems: lineItems, prepTasks: prepTasks, today: date
        )
        return Feed(surface: "beo", locationId: locationId, date: date, predictions: predictions)
    }
}
