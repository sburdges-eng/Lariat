import Foundation
import CryptoKit

/// KDS bump-back rule module — pure port of `lib/kds.ts` (Lariat-KDS protocol v2 §3).
///
/// No I/O; the repository owns the transaction. Station-slug recognition, canonical
/// ISO-8601 validation, PIN hashing, and payload validation live here exactly once,
/// mirroring the web rule module (docs/PATTERNS.md §1).
public enum KdsBumpAuditAction: String, Sendable, Equatable {
    case insert
    case correction
}

/// Result of `validateBumpPayload`. Mirrors `ValidationResult` in `lib/kds.ts`:
/// `.ok` carries the normalized (present-or-nil) fields; `.invalid` carries the reason.
public enum KdsBumpValidation: Sendable, Equatable {
    case ok(bumpedAt: String?, station: String?, cookPin: String?)
    case invalid(reason: String)
}

public enum KdsBumpRules {
    /// Known station slugs from protocol §2. Unknown values are still accepted —
    /// the KDS renders them with the default chip — so this list is informational.
    public static let knownStations = ["grill", "sides", "bar"]

    /// Lowercased non-empty string. KDS protocol §2 normalizes to lowercase.
    public static func isStationSlug(_ s: String?) -> Bool {
        guard let s, !s.isEmpty else { return false }
        return s == s.lowercased()
    }

    /// Canonical ISO-8601 UTC — round-trips through `toISOString()` (`.SSSZ`).
    /// Mirrors `new Date(Date.parse(s)).toISOString() === s`: parses only if the
    /// string is itself the canonical rendering of the instant it names.
    public static func isIso8601Utc(_ s: String?) -> Bool {
        guard let s else { return false }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: s) else { return false }
        return f.string(from: d) == s
    }

    /// SHA-256(pin) lowercase hex — byte-identical to Node
    /// `createHash('sha256').update(pin).digest('hex')`. Raw PIN never stored.
    public static func hashPin(_ pin: String) -> String {
        SHA256.hash(data: Data(pin.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// First bump → `.insert`; a re-bump (state row already exists) → `.correction`.
    public static func bumpActionForExisting(hasExisting: Bool) -> KdsBumpAuditAction {
        hasExisting ? .correction : .insert
    }

    /// Validate the bump payload. All three fields are optional per protocol §3 —
    /// a fully empty bump is valid (Swift `nil` == web absent/null). Anything
    /// *present* must pass its rule; on failure the reason names the offending field.
    public static func validateBumpPayload(bumpedAt: String?, station: String?, cookPin: String?) -> KdsBumpValidation {
        var outAt: String? = nil
        if let b = bumpedAt {
            guard isIso8601Utc(b) else {
                return .invalid(reason: "bumped_at must be a canonical ISO-8601 UTC string")
            }
            outAt = b
        }
        var outStation: String? = nil
        if let s = station {
            guard isStationSlug(s) else {
                return .invalid(reason: "station must be a non-empty lowercased slug")
            }
            outStation = s
        }
        var outPin: String? = nil
        if let p = cookPin {
            guard !p.isEmpty else {
                return .invalid(reason: "cook_pin must be a non-empty string when present")
            }
            outPin = p
        }
        return .ok(bumpedAt: outAt, station: outStation, cookPin: outPin)
    }

    /// Server-stamp when the KDS omits `bumped_at` — canonical `.SSSZ`,
    /// matching web's `new Date().toISOString()`.
    public static func nowIsoCanonical() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
}
