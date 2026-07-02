import Foundation

// Records + the room-config catalog for the stage board (A6.4). Column
// names/types match the EXISTING web schema (`stage_setups` in `lib/db.ts`
// ~L1955) — no migration. Riders are structured JSON blobs; run-of-show
// entries are `{t, what, who}` (the STAGE shape — distinct from the tonight
// page's `{time, label}` reader). Parity with `lib/stageRepo.ts`.

/// One of the six room configurations the venue can be set up as. House
/// decision captured in code (not the DB) so adding a config is a
/// code-review event. Capacity is the marketing-board cap, not the
/// fire-marshal cap. Values ported VERBATIM from `KNOWN_ROOM_CONFIGS`.
public struct RoomConfig: Sendable, Equatable, Identifiable {
    public let key: String
    public let name: String
    public let description: String
    public let layout: String
    public let capacity: Int
    public let changeoverStaff: Int
    public let changeoverMinutes: Int
    public let bestFor: String

    public var id: String { key }
}

public enum StageRoomCatalog {
    /// Web `KNOWN_ROOM_CONFIGS`, in declaration order.
    public static let knownRoomConfigs: [RoomConfig] = [
        RoomConfig(
            key: "listening_room_220",
            name: "Listening Room · 220 std",
            description: "Theater rows · all attention on stage",
            layout: "14 rows × 16 chairs · risers back third",
            capacity: 220, changeoverStaff: 5, changeoverMinutes: 35,
            bestFor: "Singer-songwriters · acoustic acts"
        ),
        RoomConfig(
            key: "cabaret_160",
            name: "Cabaret · 160",
            description: "Tops of 4 with food/drink service",
            layout: "40× 4-tops · 32 in main · 8 mezz",
            capacity: 160, changeoverStaff: 5, changeoverMinutes: 40,
            bestFor: "Jazz · soul · dinner shows"
        ),
        RoomConfig(
            key: "half_house_180",
            name: "Half-house · 180 std",
            description: "Half-tops · half open floor",
            layout: "20× 4-tops front · standing back",
            capacity: 180, changeoverStaff: 4, changeoverMinutes: 22,
            bestFor: "Folk-rock · 4-5 piece bands"
        ),
        RoomConfig(
            key: "dance_floor_240",
            name: "Dance Floor · 240 std",
            description: "All standing · open dance pit",
            layout: "no tops · barrier 6' from stage",
            capacity: 240, changeoverStaff: 5, changeoverMinutes: 35,
            bestFor: "DJ sets · honky-tonk · loud shows"
        ),
        RoomConfig(
            key: "private_dining_60",
            name: "Private Dining · 60",
            description: "Long tables · stage dressed for ambiance",
            layout: "2× banquet rows · 30 each",
            capacity: 60, changeoverStaff: 4, changeoverMinutes: 30,
            bestFor: "Rehearsal dinners · corp offsites"
        ),
        RoomConfig(
            key: "open_jam_140",
            name: "Open Jam · 140 std",
            description: "Sun nights · loose, mixed",
            layout: "12× tops floor · open bar zone",
            capacity: 140, changeoverStaff: 3, changeoverMinutes: 18,
            bestFor: "Free Sunday sessions"
        ),
    ]

    public static func isKnownRoomConfig(_ key: String) -> Bool {
        knownRoomConfigs.contains { $0.key == key }
    }

    public static func config(for key: String) -> RoomConfig? {
        knownRoomConfigs.first { $0.key == key }
    }
}

/// One run-of-show entry — the STAGE shape `{t, what, who}`.
public struct RunOfShowEntry: Codable, Sendable, Equatable {
    public var t: String       // "5:30 PM"
    public var what: String    // "Doors", "SET 1", "Curfew"
    public var who: String     // "Door · Box · Bar"

    public init(t: String, what: String, who: String) {
        self.t = t
        self.what = what
        self.who = who
    }

    /// Web `safeJson(run_of_show_json, [])` — `[]` on malformed input; entries
    /// missing a field decode with empty strings (JS object holes).
    public static func parseList(_ raw: String?) -> [RunOfShowEntry] {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return [] }
        guard let parsed = try? JSONSerialization.jsonObject(with: data),
              let arr = parsed as? [Any] else { return [] }
        return arr.compactMap { e in
            guard let obj = e as? [String: Any] else { return nil }
            return RunOfShowEntry(
                t: (obj["t"] as? String) ?? "",
                what: (obj["what"] as? String) ?? "",
                who: (obj["who"] as? String) ?? ""
            )
        }
    }

    public static func toJSON(_ entries: [RunOfShowEntry]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(entries),
              let s = String(data: data, encoding: .utf8) else { return "[]" }
        return s
    }
}

/// One `stage_setups` row with riders kept as raw JSON strings (the web edits
/// them as structured blobs; the native board renders/edits the JSON and the
/// completeness rule parses key counts) — mirrors `StageSetup`.
public struct StageSetupRow: Sendable, Identifiable, Equatable {
    public let id: Int64
    public let showId: Int64
    public let locationId: String
    public let roomConfig: String
    public let runOfShow: [RunOfShowEntry]
    /// Raw `run_of_show_json` — the tonight page reads this directly with
    /// its own `{time,label}` parser (web parity; the two readers differ).
    public let runOfShowJson: String
    public let hospitalityRiderJson: String
    public let techRiderJson: String
    public let notes: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: Int64, showId: Int64, locationId: String, roomConfig: String,
        runOfShow: [RunOfShowEntry], runOfShowJson: String = "[]",
        hospitalityRiderJson: String,
        techRiderJson: String, notes: String?, createdAt: String, updatedAt: String
    ) {
        self.id = id
        self.showId = showId
        self.locationId = locationId
        self.roomConfig = roomConfig
        self.runOfShow = runOfShow
        self.runOfShowJson = runOfShowJson
        self.hospitalityRiderJson = hospitalityRiderJson
        self.techRiderJson = techRiderJson
        self.notes = notes
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Web `safeJson(x_json, {})` key count — used by `stageCompleteness`.
    public static func riderKeyCount(_ raw: String?) -> Int {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return 0 }
        guard let parsed = try? JSONSerialization.jsonObject(with: data),
              let dict = parsed as? [String: Any] else { return 0 }
        return dict.count
    }
}

/// Completeness signal — mirrors `stageCompleteness` (four "has_*" fields).
public struct StageCompleteness: Sendable, Equatable {
    public let hasSetup: Bool
    public let hasRoomConfig: Bool
    public let hasRunOfShow: Bool
    public let hasHospitalityRider: Bool
    public let hasTechRider: Bool
    public let score: Double

    public init(
        hasSetup: Bool, hasRoomConfig: Bool, hasRunOfShow: Bool,
        hasHospitalityRider: Bool, hasTechRider: Bool, score: Double
    ) {
        self.hasSetup = hasSetup
        self.hasRoomConfig = hasRoomConfig
        self.hasRunOfShow = hasRunOfShow
        self.hasHospitalityRider = hasHospitalityRider
        self.hasTechRider = hasTechRider
        self.score = score
    }

    public static func from(setup: StageSetupRow?) -> StageCompleteness {
        guard let setup else {
            return StageCompleteness(
                hasSetup: false, hasRoomConfig: false, hasRunOfShow: false,
                hasHospitalityRider: false, hasTechRider: false, score: 0
            )
        }
        let hasRoom = StageRoomCatalog.isKnownRoomConfig(setup.roomConfig)
        let hasRos = !setup.runOfShow.isEmpty
        let hasHosp = StageSetupRow.riderKeyCount(setup.hospitalityRiderJson) > 0
        let hasTech = StageSetupRow.riderKeyCount(setup.techRiderJson) > 0
        let filled = [hasRoom, hasRos, hasHosp, hasTech].filter { $0 }.count
        return StageCompleteness(
            hasSetup: true, hasRoomConfig: hasRoom, hasRunOfShow: hasRos,
            hasHospitalityRider: hasHosp, hasTechRider: hasTech,
            score: Double(filled) / 4.0
        )
    }
}
