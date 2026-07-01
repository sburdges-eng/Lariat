import Foundation
import GRDB

public enum LineCheckStatus: String, Sendable, CaseIterable {
    case pass, fail, na
}

public struct LineCheckEntryRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let shiftDate: String
    public let stationId: String
    public let item: String
    public let status: String
    public let par: String?
    public let have: String?
    public let need: String?
    public let note: String?
    public let cookId: String?
    public let gloveChangeAttested: Int?
    public let locationId: String
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case stationId = "station_id"
        case item, status, par, have, need, note
        case cookId = "cook_id"
        case gloveChangeAttested = "glove_change_attested"
        case locationId = "location_id"
        case createdAt = "created_at"
    }
}

public struct StationSignoffRow: Codable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let shiftDate: String
    public let stationId: String
    public let cookId: String
    public let signoffType: String
    public let locationId: String
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case stationId = "station_id"
        case cookId = "cook_id"
        case signoffType = "signoff_type"
        case locationId = "location_id"
        case createdAt = "created_at"
    }
}

public struct LineCheckItemState: Equatable, Sendable {
    public let status: LineCheckStatus?
    public let par: String
    public let have: String
    public let need: String
    public let note: String
    public let gloveChangeAttested: Bool?

    public init(
        status: LineCheckStatus?,
        par: String = "",
        have: String = "",
        need: String = "",
        note: String = "",
        gloveChangeAttested: Bool? = nil
    ) {
        self.status = status
        self.par = par
        self.have = have
        self.need = need
        self.note = note
        self.gloveChangeAttested = gloveChangeAttested
    }
}

public struct StationChecklistSnapshot: Sendable {
    public let station: KitchenStation
    public let shiftDate: String
    public let templateItems: [String]
    public let items: [String: LineCheckItemState]
    public let signoff: StationSignoffRow?
    public let progress: StationProgress?

    public init(
        station: KitchenStation,
        shiftDate: String,
        templateItems: [String],
        items: [String: LineCheckItemState],
        signoff: StationSignoffRow?,
        progress: StationProgress?
    ) {
        self.station = station
        self.shiftDate = shiftDate
        self.templateItems = templateItems
        self.items = items
        self.signoff = signoff
        self.progress = progress
    }
}

public struct StationListRow: Sendable, Identifiable {
    public let station: KitchenStation
    public let progress: StationProgress?

    public var id: String { station.id }

    public init(station: KitchenStation, progress: StationProgress?) {
        self.station = station
        self.progress = progress
    }
}

public struct LineCheckPostInput: Sendable {
    public let shiftDate: String
    public let stationId: String
    public let item: String
    public let status: LineCheckStatus
    public let cookId: String
    public let par: String?
    public let have: String?
    public let need: String?
    public let note: String?
    public let gloveChangeAttested: Bool?

    public init(
        shiftDate: String,
        stationId: String,
        item: String,
        status: LineCheckStatus,
        cookId: String,
        par: String? = nil,
        have: String? = nil,
        need: String? = nil,
        note: String? = nil,
        gloveChangeAttested: Bool? = nil
    ) {
        self.shiftDate = shiftDate
        self.stationId = stationId
        self.item = item
        self.status = status
        self.cookId = cookId
        self.par = par
        self.have = have
        self.need = need
        self.note = note
        self.gloveChangeAttested = gloveChangeAttested
    }
}

public enum LineCheckWriteError: Error, LocalizedError, Equatable {
    case missingFields
    case cookRequired
    case stationNotFound
    case unnotedFails(items: [String])
    case minorProhibited(citation: String, station: String)  // L5
    case sickExcluded(citation: String)                      // L6

    public var errorDescription: String? {
        switch self {
        case .missingFields: return "Missing required fields"
        case .cookRequired: return "Pick your name first"
        case .stationNotFound: return "Station not found"
        case .unnotedFails: return "Note the fix for failed items before signing off"
        case .minorProhibited(let citation, _):
            return "This station has equipment minors can't use — \(citation)"
        case .sickExcluded(let citation):
            return "This cook is on a reportable-illness exclusion and can't work the line — \(citation)"
        }
    }
}
