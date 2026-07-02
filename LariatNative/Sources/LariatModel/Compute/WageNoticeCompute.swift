import Foundation

// Port of `lib/wageNotices.ts` — Colorado Wage Theft Transparency Act
// (C.R.S. §8-4-103) + COMPS Order #39 §3.3 written-notice obligation (L7 / A3 L4).
//
// An employer must give each employee a written notice of pay rate, pay basis,
// paydays, and (when claimed) the tip credit at hire and whenever the pay rate
// or pay basis changes; annual re-attestation surfaces stale records. Money is
// INTEGER cents. Pure module — validation + freshness math, no DB.
//
// Citation uses the CODE value (§8-4-103), NOT the schema comment's §8-4-120.

/// Why a notice was signed — matches the `wage_notices.reason` CHECK set.
/// `Codable` so `WageNoticeRow` can synthesize (GRDB decodes the raw string).
public enum WageNoticeReason: String, Codable, Sendable, Equatable, Hashable, CaseIterable {
    case hire
    case rate_change
    case annual
    case law_change
    case other
}

/// How the employee is paid — matches the `wage_notices.pay_basis` CHECK set.
public enum WageNoticePayBasis: String, Codable, Sendable, Equatable, Hashable, CaseIterable {
    case hourly
    case salary
    case commission
    case tipped
}

/// Result of `validateNoticeShape` — mirrors the JS `NoticeShapeResult`.
public struct NoticeShapeResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?
    public init(ok: Bool, reason: String?) { self.ok = ok; self.reason = reason }
}

/// Loose write payload for the shape validator (fields optional, as they arrive
/// from a request). Money is `Int` cents. Mirrors the JS `NoticeShapeInput`.
public struct WageNoticeShape: Sendable, Equatable {
    public let reason: String?
    public let payBasis: String?
    public let wageRateCents: Int?
    public let tipCreditCents: Int?
    public let signedOn: String?
    public let documentPath: String?

    public init(reason: String?, payBasis: String?, wageRateCents: Int?, tipCreditCents: Int?, signedOn: String?, documentPath: String?) {
        self.reason = reason
        self.payBasis = payBasis
        self.wageRateCents = wageRateCents
        self.tipCreditCents = tipCreditCents
        self.signedOn = signedOn
        self.documentPath = documentPath
    }
}

/// The proposed `next` notice for `requiresNewNotice`. Mirrors the JS `next` shape.
public struct WageNoticeNext: Sendable, Equatable {
    public let reason: WageNoticeReason
    public let wageRateCents: Int
    public let payBasis: WageNoticePayBasis
    public let tipCreditCents: Int?
    public let signedOn: String

    public init(reason: WageNoticeReason, wageRateCents: Int, payBasis: WageNoticePayBasis, tipCreditCents: Int?, signedOn: String) {
        self.reason = reason
        self.wageRateCents = wageRateCents
        self.payBasis = payBasis
        self.tipCreditCents = tipCreditCents
        self.signedOn = signedOn
    }
}

/// Result of `requiresNewNotice` — mirrors the JS `RequiresNewNoticeResult`.
public struct RequiresNewNoticeResult: Sendable, Equatable {
    public let required: Bool
    public let reason: String
    public init(required: Bool, reason: String) { self.required = required; self.reason = reason }
}

/// Per-cook freshness tile — mirrors the JS `NoticeFreshness`.
public struct NoticeFreshness: Sendable, Equatable {
    public let cookId: String
    public let hasNotice: Bool
    public let signedOn: String?
    public let daysSince: Int?
    public let needsNew: Bool

    public init(cookId: String, hasNotice: Bool, signedOn: String?, daysSince: Int?, needsNew: Bool) {
        self.cookId = cookId
        self.hasNotice = hasNotice
        self.signedOn = signedOn
        self.daysSince = daysSince
        self.needsNew = needsNew
    }
}

public enum WageNoticeCompute {
    public static let refreshDays = 365
    /// Byte-exact citation, asserted by the parity test. Uses §8-4-103 (the code
    /// value), NOT the schema comment's §8-4-120.
    public static let citation = "C.R.S. §8-4-103 (CO Wage Theft Transparency Act); 7 CCR 1103-1 §3.3 (COMPS Order #39)"

    // ── Helpers ───────────────────────────────────────────────────────

    static func isYMD(_ s: String) -> Bool {
        // `^\d{4}-\d{2}-\d{2}$`
        let parts = s.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2 else { return false }
        return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }

    private static let utcDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// Whole days from `a` to `b`, both `YYYY-MM-DD` parsed at UTC midnight and
    /// floored — parity with the JS `daysBetween` (`Math.floor(ms/86400000)`,
    /// `Date.parse('...T00:00:00Z')`). Returns 0 on unparseable input.
    static func daysBetween(_ a: String, _ b: String) -> Int {
        guard let da = utcDayFormatter.date(from: a), let db = utcDayFormatter.date(from: b) else { return 0 }
        let seconds = db.timeIntervalSince(da)
        guard seconds.isFinite else { return 0 }
        return Int((seconds / 86_400).rounded(.down))
    }

    // ── Pure rules ────────────────────────────────────────────────────

    /// Shape-validate a wage-notice payload. Enums match the CHECK constraints;
    /// `wageRateCents` is a non-negative Int; `tipCreditCents` (if present) is a
    /// non-negative Int and only positive on a `tipped` basis; `signedOn` is
    /// YYYY-MM-DD. Parity with the JS `validateNoticeShape`.
    public static func validateNoticeShape(_ input: WageNoticeShape) -> NoticeShapeResult {
        guard let reason = input.reason, WageNoticeReason(rawValue: reason) != nil else {
            return NoticeShapeResult(ok: false, reason: "reason must be one of: \(WageNoticeReason.allCases.map(\.rawValue).joined(separator: ", "))")
        }
        guard let payBasis = input.payBasis, WageNoticePayBasis(rawValue: payBasis) != nil else {
            return NoticeShapeResult(ok: false, reason: "pay_basis must be one of: \(WageNoticePayBasis.allCases.map(\.rawValue).joined(separator: ", "))")
        }
        guard let wage = input.wageRateCents, wage >= 0 else {
            return NoticeShapeResult(ok: false, reason: "wage_rate_cents must be a non-negative integer (cents — no floats)")
        }
        if let tip = input.tipCreditCents {
            guard tip >= 0 else {
                return NoticeShapeResult(ok: false, reason: "tip_credit_cents must be a non-negative integer or null")
            }
            if payBasis != WageNoticePayBasis.tipped.rawValue && tip > 0 {
                return NoticeShapeResult(ok: false, reason: "tip_credit_cents is only valid when pay_basis is \"tipped\"")
            }
        }
        guard let signedOn = input.signedOn, isYMD(signedOn) else {
            return NoticeShapeResult(ok: false, reason: "signed_on must be YYYY-MM-DD")
        }
        // document_path is String? in Swift — a non-string can't reach here.
        return NoticeShapeResult(ok: true, reason: nil)
    }

    /// Decide whether a new wage notice is required given the cook's latest
    /// existing notice (`prev`) and the proposed `next`. Parity with the JS
    /// `requiresNewNotice` — priority order preserved exactly.
    public static func requiresNewNotice(prev: WageNoticeRow?, next: WageNoticeNext, today: String? = nil) -> RequiresNewNoticeResult {
        let today = today ?? next.signedOn

        guard let prev else {
            return RequiresNewNoticeResult(required: true, reason: "no notice on file — first notice required at hire")
        }
        if next.reason == .rate_change {
            return RequiresNewNoticeResult(required: true, reason: "rate change — written notice required")
        }
        if prev.payBasis != next.payBasis {
            return RequiresNewNoticeResult(required: true, reason: "pay basis changed (\(prev.payBasis.rawValue) → \(next.payBasis.rawValue))")
        }
        if prev.wageRateCents != next.wageRateCents {
            return RequiresNewNoticeResult(required: true, reason: "wage rate changed (\(prev.wageRateCents)¢ → \(next.wageRateCents)¢)")
        }
        let prevTip = prev.tipCreditCents ?? 0
        let nextTip = next.tipCreditCents ?? 0
        if (prevTip > 0) != (nextTip > 0) || prevTip != nextTip {
            return RequiresNewNoticeResult(required: true, reason: "tip credit changed — §3.3 written notice required")
        }
        let days = daysBetween(prev.signedOn, today)
        if days > refreshDays {
            return RequiresNewNoticeResult(required: true, reason: "\(days) days since last notice — annual refresh due")
        }
        return RequiresNewNoticeResult(required: false, reason: "current notice is valid")
    }

    /// Tile-summary: one freshness row per (latest-per-cook) notice. Parity with
    /// the JS `summarizeFreshness`.
    public static func summarizeFreshness(_ rows: [WageNoticeRow], today: String) -> [NoticeFreshness] {
        rows.map { r in
            let days = daysBetween(r.signedOn, today)
            return NoticeFreshness(
                cookId: r.cookId,
                hasNotice: true,
                signedOn: r.signedOn,
                daysSince: days,
                needsNew: days > refreshDays
            )
        }
    }
}
