import Foundation
import GRDB

/// One `shows` row as the booking board consumes it (ShowRow in
/// lib/showsRepo.ts). `price` is a REAL dollar column on web → Double here
/// (rendered with two decimals, matching web `formatDollars`).
public struct BookingShowRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let bandName: String
    public let showDate: String
    public let price: Double?
    public let doorTix: String?
    public let statusJson: String
    public let sourceRow: Int?

    enum CodingKeys: String, CodingKey {
        case id, price
        case bandName = "band_name"
        case showDate = "show_date"
        case doorTix = "door_tix"
        case statusJson = "status_json"
        case sourceRow = "source_row"
    }

    public init(
        id: Int64,
        bandName: String,
        showDate: String,
        price: Double?,
        doorTix: String?,
        statusJson: String,
        sourceRow: Int?
    ) {
        self.id = id
        self.bandName = bandName
        self.showDate = showDate
        self.price = price
        self.doorTix = doorTix
        self.statusJson = statusJson
        self.sourceRow = sourceRow
    }

    /// Parsed status map (rowToShow's `JSON.parse(status_json)`).
    public var status: [String: String] {
        ShowPipelineCompute.parseStatusJson(statusJson)
    }
}

/// Everything the /booking page renders: the five-week calendar, the live
/// pipeline counts, and the next upcoming show.
public struct BookingBoardSnapshot: Sendable {
    public let upcoming: [BookingShowRow]
    /// Count per stage, keyed by `ShowPipelineCompute.knownStages` values.
    public let pipelineCounts: [String: Int]
    public let next: BookingShowRow?

    public init(upcoming: [BookingShowRow], pipelineCounts: [String: Int], next: BookingShowRow?) {
        self.upcoming = upcoming
        self.pipelineCounts = pipelineCounts
        self.next = next
    }
}
