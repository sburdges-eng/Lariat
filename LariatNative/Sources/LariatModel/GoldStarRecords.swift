import Foundation
import GRDB

// Record types for /gold-stars (A6.2) — parity with `app/gold-stars/*` +
// `app/api/gold-stars/{route.ts,[id]/route.ts}`. `stars` is an INTEGER
// count (1–3), not money.

/// One `gold_stars` row (the daily board feed).
public struct GoldStarRow: Sendable, Equatable, Identifiable, FetchableRecord {
    public let id: Int64
    public let cookName: String
    public let reason: String
    public let stars: Int
    public let awardedDate: String?
    public let locationId: String
    public let createdAt: String?
    public let deletedAt: String?
    public let deletedBy: String?

    public init(row: Row) {
        id = row["id"]
        cookName = row["cook_name"]
        reason = row["reason"]
        stars = row["stars"] ?? 1        // board maps `row.stars || 1`
        awardedDate = row["awarded_date"]
        locationId = row["location_id"]
        createdAt = row["created_at"]
        deletedAt = row["deleted_at"]
        deletedBy = row["deleted_by"]
    }
}

/// One leaderboard row — the permanent per-employee record
/// (`GET /api/gold-stars?view=leaderboard`).
public struct GoldStarLeaderboardRow: Sendable, Equatable, Identifiable, FetchableRecord {
    public let cookName: String
    public let totalStars: Int
    public let awards: Int
    public let lastAwarded: String?

    public var id: String { cookName }

    public init(row: Row) {
        cookName = row["cook_name"]
        totalStars = row["total_stars"] ?? 0
        awards = row["awards"] ?? 0
        lastAwarded = row["last_awarded"]
    }
}

/// Star tiers from `GoldStarBoard.tsx` STAR_TIERS.
public enum GoldStarTier: Int, CaseIterable, Sendable {
    case one = 1, two = 2, three = 3

    public var label: String {
        switch self {
        case .one: return "★ Good"
        case .two: return "★★ Great"
        case .three: return "★★★ Exceptional"
        }
    }
}

/// Typed write failures — the routes' 400/404 contracts, thrown BEFORE any
/// write. Messages mirror the routes' `{ error }` strings.
public enum GoldStarWriteError: Error, Equatable, LocalizedError {
    /// POST 400 — `'Cook and reason needed'`.
    case cookAndReasonRequired
    /// DELETE 400 — `'invalid id'`.
    case invalidId
    /// DELETE 404 — missing row, wrong location, or already soft-deleted
    /// (NO idempotency: a second delete of the same star is 404 on the web).
    case notFound

    public var errorDescription: String? {
        switch self {
        case .cookAndReasonRequired: return "Cook and reason needed"
        case .invalidId: return "invalid id"
        case .notFound: return "not found"
        }
    }
}

/// Pure gold-stars rules.
public enum GoldStarCompute {
    /// Explicit bounding on stars 1–3 — parity with
    /// `Math.min(Math.max(Number(stars) || 1, 1), 3)` (route.ts L78):
    /// nil/0 are falsy → 1; then clamped into 1...3.
    public static func clampStars(_ stars: Int?) -> Int {
        let base = (stars == nil || stars == 0) ? 1 : stars!
        return min(max(base, 1), 3)
    }
}
