import Foundation
import GRDB

// Records + write errors for the shows domain (A6.4). Column names/types match
// the EXISTING web schema (`shows`, `shows_archive` in `lib/db.ts` ~L1907) —
// no migration. `status_json` stays a raw string on the row; callers parse it
// via `ShowsTonightCompute.parseStatusJson` (defensive, `{}` on failure) —
// parity with `lib/showsRepo.ts` / `lib/showsTonight.ts`.

/// Sendable JSON scalar/tree for parsed `status_json` blobs. The web treats
/// status values as `unknown`; this enum is the native analog so pure rules
/// (`ShowStatusCompute`, `ShowsTonightCompute`) can coerce with JS semantics.
public enum ShowStatusValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: ShowStatusValue])
    case array([ShowStatusValue])
    case null

    /// Convert a `JSONSerialization` value into a `ShowStatusValue`.
    public static func from(_ any: Any) -> ShowStatusValue {
        switch any {
        case let s as String: return .string(s)
        case let n as NSNumber:
            // NSNumber bridges bools too — CFBoolean check keeps `true` ≠ `1`.
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            return .number(n.doubleValue)
        case let d as [String: Any]:
            return .object(d.mapValues { ShowStatusValue.from($0) })
        case let a as [Any]:
            return .array(a.map { ShowStatusValue.from($0) })
        case is NSNull: return .null
        default: return .null
        }
    }

    /// JS `String(value)` coercion (best effort for the shapes ingest writes).
    public var jsString: String {
        switch self {
        case .string(let s): return s
        case .number(let n): return ShowStatusValue.jsNumberString(n)
        case .bool(let b): return b ? "true" : "false"
        case .object: return "[object Object]"
        case .array(let a): return a.map(\.jsString).joined(separator: ",")
        case .null: return "null"
        }
    }

    /// JS `Number(value)` coercion. Returns NaN (as `Double.nan`) where JS would.
    public var jsNumber: Double {
        switch self {
        case .string(let s): return ShowStatusValue.jsNumber(from: s)
        case .number(let n): return n
        case .bool(let b): return b ? 1 : 0
        case .null: return 0
        case .object: return .nan
        case .array(let a):
            // JS Number([]) = 0, Number([x]) = Number(x), else NaN.
            if a.isEmpty { return 0 }
            if a.count == 1 { return a[0].jsNumber }
            return .nan
        }
    }

    /// JS `Number(string)` — trimmed; empty → 0; unparseable → NaN.
    public static func jsNumber(from raw: String) -> Double {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return 0 }
        return Double(t) ?? .nan
    }

    /// JS number → string: integral values render without a decimal point.
    public static func jsNumberString(_ n: Double) -> String {
        if n.isNaN { return "NaN" }
        if n.isInfinite { return n > 0 ? "Infinity" : "-Infinity" }
        if n == n.rounded() && abs(n) < 1e15 {
            return String(Int64(n))
        }
        return String(n)
    }
}

/// One `shows` row — parity with `ShowRow` in `lib/showsRepo.ts` /
/// `lib/showsTonight.ts`. `price` is a REAL dollars column (display only).
public struct ShowRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let bandName: String
    public let showDate: String        // ISO YYYY-MM-DD
    public let price: Double?
    public let doorTix: String?
    public let statusJson: String

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case bandName = "band_name"
        case showDate = "show_date"
        case price
        case doorTix = "door_tix"
        case statusJson = "status_json"
    }

    public init(
        id: Int64, locationId: String, bandName: String, showDate: String,
        price: Double?, doorTix: String?, statusJson: String
    ) {
        self.id = id
        self.locationId = locationId
        self.bandName = bandName
        self.showDate = showDate
        self.price = price
        self.doorTix = doorTix
        self.statusJson = statusJson
    }

    /// Parsed `status_json` — `{}` on any parse failure (web `rowToShow` /
    /// `parseStatusJson` contract).
    public var status: [String: ShowStatusValue] {
        ShowsTonightCompute.parseStatusJson(statusJson)
    }
}

/// One `shows_archive` row — parity with `ArchiveRow` in `lib/showsRepo.ts`.
public struct ShowsArchiveRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let bandName: String
    public let showDate: String
    public let eraYear: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case bandName = "band_name"
        case showDate = "show_date"
        case eraYear = "era_year"
    }

    public init(id: Int64, bandName: String, showDate: String, eraYear: Int?) {
        self.id = id
        self.bandName = bandName
        self.showDate = showDate
        self.eraYear = eraYear
    }
}

/// Typed failures for shows-domain writes — mirrors the web routes' status
/// semantics (400 → `validationFailed`, 404 → `notFound`).
public enum ShowsWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    case notFound
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .notFound: return "Not found"
        case .persistenceFailed: return "Could not persist the change"
        }
    }
}
