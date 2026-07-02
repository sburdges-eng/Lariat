import Foundation
import GRDB

// Records + write-error types for the paid-sick-leave board (A3 / L2, HFWA).
// Column names/types match the EXISTING web schema (`paid_sick_leave_balances`
// in `lib/db.ts` ~L2821) — no migration. Mirrors the `SickWorkerRow`/`StaffCertRow`
// convention: the row conforms to GRDB `FetchableRecord` here in LariatModel
// (which already depends on GRDB) so the repository can decode it directly.
//
// Compliance: C.R.S. §8-13.3-401 et seq. (Colorado Healthy Families and
// Workplaces Act — HFWA). All hour arithmetic is `Double` (the DB stores REAL),
// never `Decimal`. See `SickLeaveCompute` for the pinned accrual/use/cap rules.

/// Sick-leave write failures — mirror `app/api/sick-leave/route.js` status
/// semantics. `validationFailed` → web 400 (bad kind / cook_id / year / hours /
/// dated_on); `capReached` → web 422 (accrual clipped to zero); `notEnough` →
/// web 422 (use exceeds available). The 422 cases throw BEFORE the audit write
/// (inside `AuditedWriteRunner.perform`) so a rollback leaves no row-change and
/// no audit — parity with the web route's "no audit on 422".
public enum SickLeaveWriteError: Error, LocalizedError, Equatable {
    case validationFailed(String)
    /// Accrual produced <= 0 hours (cap reached or zero). Carries the rule
    /// reason + the uncapped hours for the UI to surface (web 422 body).
    case capReached(reason: String, hoursUncapped: Double)
    /// Use exceeds available balance. Carries the reason + the (unchanged)
    /// available balance for the UI (web 422 body).
    case notEnough(reason: String, hoursAvailable: Double)
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .validationFailed(let msg): return msg
        case .capReached(let reason, _): return reason
        case .notEnough(let reason, _): return reason
        case .persistenceFailed: return "Could not save sick-leave entry"
        }
    }
}

/// The two write actions on the board — parity with the route's `KIND_VALUES`
/// (`accrual` | `use`). Raw values match what the web body sends.
public enum SickLeaveKind: String, Sendable, Equatable, CaseIterable {
    case accrual
    case use
}

/// Input for an accrual (add hours). Either `hours` (front-loaded direct add) or
/// `hoursWorked` (HFWA 1:30 ratio) drives the accrual — parity with the route:
/// when only `hours` is given the repo synthesizes `drivingHoursWorked = hours *
/// 30` so the 48h annual cap still binds the front-load. When `hoursWorked` is
/// given it is used directly.
public struct SickLeaveAccrualInput: Sendable {
    public let cookId: String
    public let accrualYear: Int
    public let hours: Double?
    public let hoursWorked: Double?
    public let note: String?
    public let datedOn: String?

    public init(
        cookId: String,
        accrualYear: Int,
        hours: Double? = nil,
        hoursWorked: Double? = nil,
        note: String? = nil,
        datedOn: String? = nil
    ) {
        self.cookId = cookId
        self.accrualYear = accrualYear
        self.hours = hours
        self.hoursWorked = hoursWorked
        self.note = note
        self.datedOn = datedOn
    }
}

/// Input for a use (spend hours). `hours` is the only path (parity with route).
public struct SickLeaveUseInput: Sendable {
    public let cookId: String
    public let accrualYear: Int
    public let hours: Double
    public let note: String?
    public let datedOn: String?

    public init(
        cookId: String,
        accrualYear: Int,
        hours: Double,
        note: String? = nil,
        datedOn: String? = nil
    ) {
        self.cookId = cookId
        self.accrualYear = accrualYear
        self.hours = hours
        self.note = note
        self.datedOn = datedOn
    }
}

/// Result of a successful write — mirrors the web POST 200 body
/// (`{ ok, kind, hours_applied, balance }`).
public struct SickLeaveWriteResult: Sendable, Equatable {
    public let kind: SickLeaveKind
    public let hoursApplied: Double
    public let balance: BalanceSummary
    public let row: SickLeaveBalanceRow

    public init(kind: SickLeaveKind, hoursApplied: Double, balance: BalanceSummary, row: SickLeaveBalanceRow) {
        self.kind = kind
        self.hoursApplied = hoursApplied
        self.balance = balance
        self.row = row
    }
}

/// One audit event row for the balance history subtitle — mirrors the web GET
/// `events[]` projection (`id, action, note, created_at`).
public struct SickLeaveEvent: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let action: String
    public let note: String?
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case action
        case note
        case createdAt = "created_at"
    }

    public init(id: Int64, action: String, note: String?, createdAt: String?) {
        self.id = id
        self.action = action
        self.note = note
        self.createdAt = createdAt
    }
}

/// Full `paid_sick_leave_balances` row for board display + audit payload + the
/// pure `SickLeaveCompute` rules. Column names/types match the EXISTING web
/// schema in `lib/db.ts` (~L2821) — no migration. Hours are `Double` (REAL).
public struct SickLeaveBalanceRow: Codable, FetchableRecord, Sendable, Identifiable, Equatable {
    public let id: Int64
    public let locationId: String
    public let cookId: String
    public let accrualYear: Int
    public let hoursAccrued: Double
    public let hoursUsed: Double
    public let capHours: Double
    public let carryoverHours: Double
    public let lastAccruedOn: String?
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case locationId = "location_id"
        case cookId = "cook_id"
        case accrualYear = "accrual_year"
        case hoursAccrued = "hours_accrued"
        case hoursUsed = "hours_used"
        case capHours = "cap_hours"
        case carryoverHours = "carryover_hours"
        case lastAccruedOn = "last_accrued_on"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(
        id: Int64, locationId: String, cookId: String, accrualYear: Int,
        hoursAccrued: Double, hoursUsed: Double, capHours: Double,
        carryoverHours: Double, lastAccruedOn: String?,
        createdAt: String?, updatedAt: String?
    ) {
        self.id = id
        self.locationId = locationId
        self.cookId = cookId
        self.accrualYear = accrualYear
        self.hoursAccrued = hoursAccrued
        self.hoursUsed = hoursUsed
        self.capHours = capHours
        self.carryoverHours = carryoverHours
        self.lastAccruedOn = lastAccruedOn
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
