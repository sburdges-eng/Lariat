import Foundation
import GRDB

// ── Temp-PIN pure rules — parity with `lib/tempPin.ts` ────────────────────────

/// Issuance-side rules for temp PINs (the verifier side already lives in
/// `TempPinVerifier` / `PinHash`). No I/O; repositories call these and own
/// the DB layer.
public enum TempPinRules {
    /// Scopes a temp PIN can be issued with — EXACT port of `KNOWN_SCOPES`
    /// in `lib/tempPin.ts` (coarse string keys, not full RBAC). The web list
    /// is authoritative; never add scopes natively.
    public static let knownScopes: [String] = [
        "beo.fire_at_edit",     // course CRUD + line→course binding (BEO fire times)
        "event.box_office",     // door crew: walkup tickets + comp + scan
        "event.sound_config",   // sound engineer: scene save/edit during a show
        "event.stage_setup",    // stage tech: stage config + scene saves
        "haccp.back_date",      // PIC delegate: back-date a forgotten temp / fridge log entry
        "menu.prep_history",    // line lead: read-only prep-history lookup
        "menu.specials_edit",   // sandbox specials: create/edit/delete saved specials
        "pic.sick_worker",      // PIC delegate: file/clear sick reports (history stays master-only)
        "pic.staff_certs",      // PIC delegate: record/update staff certs
    ]

    private static let knownScopeSet = Set(knownScopes)

    public static func isKnownScope(_ scope: String) -> Bool {
        knownScopeSet.contains(scope)
    }

    /// `serializeScopes` — throws on unknown scopes (defensive guard to keep
    /// junk out of the `scopes_json` column; callers validate inputs first).
    public static func serializeScopes(_ scopes: [String]) throws -> String {
        for s in scopes where !knownScopeSet.contains(s) {
            throw TempPinWriteError.validation("unknown scope: \(s)")
        }
        let data = try JSONEncoder().encode(scopes)
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    /// `isExpired` — fail-closed: any non-canonical or unparseable
    /// `expires_at` is treated as expired, so a corrupted row never grants
    /// authority.
    public static func isExpired(_ expiresAt: String, now: Date = Date()) -> Bool {
        guard let date = AuditLogCompute.parseTimestamp(expiresAt) else { return true }
        return date.timeIntervalSince1970 <= now.timeIntervalSince1970
    }

    /// The issue route's `isCanonicalIso` — parseable AND round-trips to the
    /// exact same string via `toISOString()` (always fractional + Z).
    public static func isCanonicalISO(_ value: String) -> Bool {
        guard let date = Self.isoFractional.date(from: value) else { return false }
        return Self.isoFractional.string(from: date) == value
    }

    /// `new Date().toISOString()` equivalent for building canonical expiries.
    public static func canonicalISO(from date: Date) -> String {
        Self.isoFractional.string(from: date)
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

// ── Typed write errors (native analog of the routes' status codes) ────────────

/// `POST /api/auth/manager-pins` maps every rule failure to 422 with the
/// error message; natively these are typed and thrown BEFORE any write/audit.
public enum ManagerPinWriteError: Error, LocalizedError, Equatable {
    case validation(String)   // web 422 (name/PIN/role/id rule failures)
    case notFound             // web 422 "manager PIN user not found"
    case persistenceFailed    // web 500

    public var errorDescription: String? {
        switch self {
        case .validation(let msg): return msg
        case .notFound: return "manager PIN user not found"
        case .persistenceFailed: return "could not save PIN user"
        }
    }
}

/// Temp-PIN issuance/revocation failures — web status parity:
/// `.validation` → 422, `.notFound` → 404, `.exhausted` → 503, else 500.
public enum TempPinWriteError: Error, LocalizedError, Equatable {
    case validation(String)
    case notFound
    case exhausted            // "could not find a free PIN; try again"
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validation(let msg): return msg
        case .notFound: return "temp pin not found"
        case .exhausted: return "could not find a free PIN; try again"
        case .persistenceFailed: return "could not issue PIN"
        }
    }
}

// ── Row records (never carry pin_hash or a raw PIN) ───────────────────────────

/// Public projection of one `manager_pin_users` row — parity with the web
/// `publicUser()` shape. `pin_hash` is structurally absent: it is never
/// SELECTed into this record, so it cannot leak to the UI or logs.
public struct ManagerPinRecord: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let name: String
    public let role: String
    public let isActive: Int
    public let createdAt: String
    public let updatedAt: String
    public let disabledAt: String?

    public var active: Bool { isActive == 1 }

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case name
        case role
        case isActive = "is_active"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case disabledAt = "disabled_at"
    }
}

/// Active temp-PIN metadata — parity with `GET /api/auth/temp-pin/list`.
/// NEVER carries `pin_hash` or the raw PIN (spec invariant 4: unrecoverable
/// after issuance).
public struct TempPinRecord: Sendable, Identifiable, Equatable {
    public let id: Int64
    public let label: String
    public let scopes: [String]
    public let issuedAt: String
    public let expiresAt: String

    public init(id: Int64, label: String, scopes: [String], issuedAt: String, expiresAt: String) {
        self.id = id
        self.label = label
        self.scopes = scopes
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
    }
}

/// Result of a successful issuance — the ONE place the raw PIN ever appears.
/// Callers display it once and must not persist it anywhere.
public struct TempPinIssueResult: Sendable, Equatable {
    public let id: Int64
    public let pin: String
    public let label: String
    public let scopes: [String]
    public let expiresAt: String

    public init(id: Int64, pin: String, label: String, scopes: [String], expiresAt: String) {
        self.id = id
        self.pin = pin
        self.label = label
        self.scopes = scopes
        self.expiresAt = expiresAt
    }
}
