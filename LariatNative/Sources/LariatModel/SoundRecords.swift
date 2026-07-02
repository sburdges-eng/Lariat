import Foundation
import GRDB

// Records + inputs for the sound board (A6.4). Column names/types match the
// EXISTING web schema (`sound_scenes`, `spl_readings` in `lib/db.ts` ~L1971)
// — no migration. Plot is one JSON blob per scene (atomic-by-scene edits,
// band-specific channel layouts) — parity with `lib/soundRepo.ts`.

/// One plot channel — mirrors `ChannelEntry`.
public struct SoundChannelEntry: Codable, Sendable, Equatable {
    public let id: String            // 'kick', 'vox-ld', ...
    public let label: String
    public let sourceType: String    // 'mic' | 'di' | 'submix'
    public let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, label, notes
        case sourceType = "source_type"
    }

    public init(id: String, label: String, sourceType: String, notes: String? = nil) {
        self.id = id
        self.label = label
        self.sourceType = sourceType
        self.notes = notes
    }
}

/// One monitor mix — mirrors `MonitorMix`.
public struct SoundMonitorMix: Codable, Sendable, Equatable {
    public let id: String            // 'M1', 'IEM-1'
    public let type: String          // 'wedge' | 'iem'
    public let channels: [String]
    public let notes: String?

    public init(id: String, type: String, channels: [String], notes: String? = nil) {
        self.id = id
        self.type = type
        self.channels = channels
        self.notes = notes
    }
}

/// Structured scene plot — mirrors `SoundPlot`. Decoded defensively: a
/// corrupt `plot_json` collapses to an empty plot (dashboard must not crash).
public struct SoundPlot: Codable, Sendable, Equatable {
    public var channels: [SoundChannelEntry]
    public var monitors: [SoundMonitorMix]
    public var splLimitDb: Double?
    public var notes: String?

    enum CodingKeys: String, CodingKey {
        case channels, monitors, notes
        case splLimitDb = "spl_limit_db"
    }

    public init(
        channels: [SoundChannelEntry] = [],
        monitors: [SoundMonitorMix] = [],
        splLimitDb: Double? = nil,
        notes: String? = nil
    ) {
        self.channels = channels
        self.monitors = monitors
        self.splLimitDb = splLimitDb
        self.notes = notes
    }

    public static let empty = SoundPlot()

    /// Web `safeJson(plot_json, {channels:[],monitors:[]})`.
    public static func parse(_ raw: String?) -> SoundPlot {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return .empty }
        return (try? JSONDecoder().decode(SoundPlot.self, from: data)) ?? .empty
    }

    public func toJSON() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(self),
              let s = String(data: data, encoding: .utf8) else {
            return #"{"channels":[],"monitors":[]}"#
        }
        return s
    }
}

/// One `sound_scenes` row with the plot decoded — mirrors `SoundScene`.
public struct SoundSceneRow: Sendable, Identifiable, Equatable {
    public let id: Int64
    public let showId: Int64
    public let locationId: String
    public let sceneName: String
    public let plot: SoundPlot
    public let splLimitDb: Double?
    public let notes: String?
    public let savedByCookId: String?
    public let savedAt: String

    public init(
        id: Int64, showId: Int64, locationId: String, sceneName: String,
        plot: SoundPlot, splLimitDb: Double?, notes: String?,
        savedByCookId: String?, savedAt: String
    ) {
        self.id = id
        self.showId = showId
        self.locationId = locationId
        self.sceneName = sceneName
        self.plot = plot
        self.splLimitDb = splLimitDb
        self.notes = notes
        self.savedByCookId = savedByCookId
        self.savedAt = savedAt
    }
}

/// One `spl_readings` row — mirrors `SplReadingRow` in `lib/soundRepo.ts`.
public struct SplReadingRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let showId: Int64
    public let locationId: String
    public let sceneId: Int64?
    public let dbValue: Double
    public let takenAt: String
    public let takenByCookId: String?
    public let notes: String?

    enum CodingKeys: String, CodingKey {
        case id, notes
        case showId = "show_id"
        case locationId = "location_id"
        case sceneId = "scene_id"
        case dbValue = "db_value"
        case takenAt = "taken_at"
        case takenByCookId = "taken_by_cook_id"
    }

    public init(
        id: Int64, showId: Int64, locationId: String, sceneId: Int64?,
        dbValue: Double, takenAt: String, takenByCookId: String?, notes: String?
    ) {
        self.id = id
        self.showId = showId
        self.locationId = locationId
        self.sceneId = sceneId
        self.dbValue = dbValue
        self.takenAt = takenAt
        self.takenByCookId = takenByCookId
        self.notes = notes
    }
}

/// Completeness signal — mirrors `soundCompleteness` (three milestones:
/// any scene, ≥2 scenes, SPL limit set).
public struct SoundCompleteness: Sendable, Equatable {
    public let hasAnyScene: Bool
    public let sceneCount: Int
    public let hasSplLimit: Bool
    public let score: Double

    public init(hasAnyScene: Bool, sceneCount: Int, hasSplLimit: Bool, score: Double) {
        self.hasAnyScene = hasAnyScene
        self.sceneCount = sceneCount
        self.hasSplLimit = hasSplLimit
        self.score = score
    }

    public static func from(scenes: [SoundSceneRow]) -> SoundCompleteness {
        let hasAny = !scenes.isEmpty
        let hasSpl = scenes.contains { $0.splLimitDb != nil }
        let milestones = [hasAny, scenes.count >= 2, hasSpl].filter { $0 }.count
        return SoundCompleteness(
            hasAnyScene: hasAny, sceneCount: scenes.count,
            hasSplLimit: hasSpl, score: Double(milestones) / 3.0
        )
    }
}
