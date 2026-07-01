import Foundation

// Port of `lib/sickLeave.ts` — Colorado Healthy Families and Workplaces Act
// (HFWA) accrual + use + cap math for the A3 sick-leave board.
//
// Citation: C.R.S. §8-13.3-401 et seq. (HFWA).
//
// HFWA rules (pinned by tests/js/test-sick-leave-rules.mjs):
// - Employees accrue 1 hour of paid sick leave per 30 hours worked.
// - Annual cap: up to 48 hours accrued per year. Employer may front-load 48h
//   at the start of the year as an alternative to accrual tracking.
// - The cap is on `hours_accrued` ONLY — `carryover_hours` (already-credited
//   time from a prior year) NEVER counts against the accrual cap.
//
// Pure (no I/O). The repository wraps these rules with the DB upsert. All hour
// arithmetic is `Double` (the DB stores REAL), matching JS `number`. Rounding
// uses `.toNearestOrAwayFromZero` to mirror JS `Math.round` (all hours >= 0).

/// Lightweight balance value the pure rules operate on — mirrors the JS
/// `SickLeaveBalanceRow` shape used by the rule module (only the numeric buckets
/// matter to the math). Fields are plain `Double` so the "missing fields" case
/// (NaN / Infinity) can be exercised exactly as the JS test does. Construct one
/// from a `SickLeaveBalanceRow` via `init(row:)`.
public struct SickLeaveState: Sendable, Equatable {
    public let cookId: String
    public let accrualYear: Int
    public let hoursAccrued: Double
    public let hoursUsed: Double
    public let capHours: Double
    public let carryoverHours: Double

    public init(
        cookId: String = "",
        accrualYear: Int = 0,
        hoursAccrued: Double = 0,
        hoursUsed: Double = 0,
        capHours: Double = SickLeaveCompute.hfwaAnnualCapHours,
        carryoverHours: Double = 0
    ) {
        self.cookId = cookId
        self.accrualYear = accrualYear
        self.hoursAccrued = hoursAccrued
        self.hoursUsed = hoursUsed
        self.capHours = capHours
        self.carryoverHours = carryoverHours
    }

    public init(row: SickLeaveBalanceRow) {
        self.cookId = row.cookId
        self.accrualYear = row.accrualYear
        self.hoursAccrued = row.hoursAccrued
        self.hoursUsed = row.hoursUsed
        self.capHours = row.capHours
        self.carryoverHours = row.carryoverHours
    }
}

/// Mirror of the JS `AccrualResult`.
public struct AccrualResult: Sendable, Equatable {
    /// Actual hours added to the balance (after cap).
    public let hoursAdded: Double
    /// True if the cap clipped the accrual.
    public let capped: Bool
    /// Raw hours earned before capping (audit aid).
    public let hoursUncapped: Double
    public let reason: String?

    public init(hoursAdded: Double, capped: Bool, hoursUncapped: Double, reason: String?) {
        self.hoursAdded = hoursAdded
        self.capped = capped
        self.hoursUncapped = hoursUncapped
        self.reason = reason
    }
}

/// Mirror of the JS `UseResult`.
public struct UseResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?
    /// hours_available AFTER the use; unchanged on failure.
    public let newBalance: Double

    public init(ok: Bool, reason: String?, newBalance: Double) {
        self.ok = ok
        self.reason = reason
        self.newBalance = newBalance
    }
}

/// Mirror of the JS `BalanceSummary` (the GET response + board tile shape).
public struct BalanceSummary: Sendable, Equatable {
    public let cookId: String
    public let accrualYear: Int
    public let hoursAccrued: Double
    public let hoursUsed: Double
    /// accrued + carryover − used; never < 0.
    public let hoursAvailable: Double
    public let capHours: Double
    public let carryoverHours: Double
    /// True when accrued >= cap (further accrual is a no-op).
    public let atCap: Bool

    public init(
        cookId: String, accrualYear: Int, hoursAccrued: Double, hoursUsed: Double,
        hoursAvailable: Double, capHours: Double, carryoverHours: Double, atCap: Bool
    ) {
        self.cookId = cookId
        self.accrualYear = accrualYear
        self.hoursAccrued = hoursAccrued
        self.hoursUsed = hoursUsed
        self.hoursAvailable = hoursAvailable
        self.capHours = capHours
        self.carryoverHours = carryoverHours
        self.atCap = atCap
    }
}

public enum SickLeaveCompute {
    /// 30 hours worked per 1 hour of paid sick leave earned (HFWA).
    public static let hfwaAccrualHoursWorkedPerHourEarned: Double = 30
    /// Annual accrual cap: 48 hours per year.
    public static let hfwaAnnualCapHours: Double = 48
    /// Compliance citation — byte-exact, asserted by the parity test (/8-13\.3-401/).
    public static let hfwaCitation = "C.R.S. §8-13.3-401 (HFWA)"

    // ── Helpers ───────────────────────────────────────────────────────

    /// Mirror of the JS `isFiniteNonNeg`: finite AND >= 0.
    static func isFiniteNonNeg(_ n: Double) -> Bool {
        n.isFinite && n >= 0
    }

    /// Mirror of the JS `roundHours` = `Math.round(h * 100) / 100`. Uses
    /// `.toNearestOrAwayFromZero` (NOT `.toNearestOrEven`) to match `Math.round`;
    /// all hours are >= 0 so away-from-zero == JS behavior.
    public static func roundHours(_ h: Double) -> Double {
        (h * 100).rounded(.toNearestOrAwayFromZero) / 100
    }

    // ── Pure rules ────────────────────────────────────────────────────

    /// Accrue sick-leave hours for `hoursWorked` against `currentBalance`.
    /// Parity with the JS `accrueHours`. The cap is on `hours_accrued` (lifetime
    /// this accrual_year) and does NOT include `carryover_hours`.
    public static func accrueHours(_ currentBalance: SickLeaveState, hoursWorked: Double) -> AccrualResult {
        if !isFiniteNonNeg(hoursWorked) {
            return AccrualResult(hoursAdded: 0, capped: false, hoursUncapped: 0, reason: "hoursWorked must be a non-negative number")
        }
        if hoursWorked == 0 {
            return AccrualResult(hoursAdded: 0, capped: false, hoursUncapped: 0, reason: nil)
        }
        let cap = isFiniteNonNeg(currentBalance.capHours) ? currentBalance.capHours : hfwaAnnualCapHours
        let accrued = isFiniteNonNeg(currentBalance.hoursAccrued) ? currentBalance.hoursAccrued : 0

        let earnedRaw = hoursWorked / hfwaAccrualHoursWorkedPerHourEarned
        let room = max(0, cap - accrued)
        let earnedCapped = min(earnedRaw, room)
        let capped = earnedCapped < earnedRaw - 1e-9  // float tolerance

        return AccrualResult(
            hoursAdded: roundHours(earnedCapped),
            capped: capped,
            hoursUncapped: roundHours(earnedRaw),
            reason: (capped && earnedCapped == 0) ? "cap reached — no further accrual this year" : nil
        )
    }

    /// Use `hoursToUse` from the balance. Available pool is
    /// accrued + carryover − used. Parity with the JS `useHours`.
    public static func useHours(_ currentBalance: SickLeaveState, hoursToUse: Double) -> UseResult {
        if !isFiniteNonNeg(hoursToUse) || hoursToUse == 0 {
            return UseResult(ok: false, reason: "hoursToUse must be a positive number", newBalance: hoursAvailable(currentBalance))
        }
        let available = hoursAvailable(currentBalance)
        if hoursToUse > available + 1e-9 {
            return UseResult(
                ok: false,
                reason: "not enough sick time — have \(numString(roundHours(available))), need \(numString(roundHours(hoursToUse)))",
                newBalance: available
            )
        }
        return UseResult(ok: true, reason: nil, newBalance: roundHours(available - hoursToUse))
    }

    /// Hours of paid sick leave currently available: accrued + carryover − used,
    /// floored at 0. Parity with the JS `hoursAvailable`.
    public static func hoursAvailable(_ row: SickLeaveState) -> Double {
        let accrued = isFiniteNonNeg(row.hoursAccrued) ? row.hoursAccrued : 0
        let used = isFiniteNonNeg(row.hoursUsed) ? row.hoursUsed : 0
        let carry = isFiniteNonNeg(row.carryoverHours) ? row.carryoverHours : 0
        return roundHours(max(0, accrued + carry - used))
    }

    /// Roll a row into a UI-ready summary. Parity with the JS `summarizeBalance`.
    public static func summarizeBalance(_ row: SickLeaveState) -> BalanceSummary {
        let cap = isFiniteNonNeg(row.capHours) ? row.capHours : hfwaAnnualCapHours
        let accrued = isFiniteNonNeg(row.hoursAccrued) ? row.hoursAccrued : 0
        let used = isFiniteNonNeg(row.hoursUsed) ? row.hoursUsed : 0
        let carry = isFiniteNonNeg(row.carryoverHours) ? row.carryoverHours : 0
        return BalanceSummary(
            cookId: row.cookId,
            accrualYear: row.accrualYear,
            hoursAccrued: roundHours(accrued),
            hoursUsed: roundHours(used),
            hoursAvailable: roundHours(max(0, accrued + carry - used)),
            capHours: roundHours(cap),
            carryoverHours: roundHours(carry),
            atCap: accrued >= cap - 1e-9
        )
    }

    // ── Number formatting for messages ─────────────────────────────────

    /// Format a rounded hour value the way JS string-interpolation would (an
    /// integer prints without a decimal point, e.g. `4` not `4.0`) so the
    /// "not enough sick time — have 4, need 8" message matches the web body.
    static func numString(_ h: Double) -> String {
        if h == h.rounded() && abs(h) < 1e15 {
            return String(Int(h))
        }
        var s = String(h)
        if s.hasSuffix(".0") { s.removeLast(2) }
        return s
    }
}
