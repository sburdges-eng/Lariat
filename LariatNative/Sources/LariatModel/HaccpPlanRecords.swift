import Foundation
import GRDB

// Port of the plan structs in `lib/haccpPlan.ts` — the inspector-ready HACCP
// plan aggregate. READ-ONLY: no writes, no audit. The web page at
// /food-safety/haccp-plan renders this object; the GET-only API serves it raw.
//
// This file holds:
//   1. The output structs (HaccpPlan + its sections), mirroring the TS interfaces.
//   2. The raw GRDB row types the repository SELECTs into.
//   3. The HaccpPlanBundle the repository packs and HaccpPlanCompute assembles.
//
// All numbers/citations are faithfully copied from the web rule modules; see
// HaccpPlanCompute for the assembled citation constants.

// MARK: - Output structs (mirror lib/haccpPlan.ts interfaces)

/// One monitored CCP temp point with 30-day evidence counts.
/// Mirrors `HaccpPlanCcp`.
public struct HaccpPlanCcp: Sendable, Equatable, Identifiable {
    public let pointId: String
    public let label: String
    public let ccpId: String
    public let requiredMinF: Double?
    public let requiredMaxF: Double?
    public let citation: String
    /// temp_log rows for this point in the window.
    public let logs30d: Int
    /// Of those, rows that carried a corrective action.
    public let corrective30d: Int

    public var id: String { pointId }

    public init(
        pointId: String, label: String, ccpId: String,
        requiredMinF: Double?, requiredMaxF: Double?, citation: String,
        logs30d: Int, corrective30d: Int
    ) {
        self.pointId = pointId
        self.label = label
        self.ccpId = ccpId
        self.requiredMinF = requiredMinF
        self.requiredMaxF = requiredMaxF
        self.citation = citation
        self.logs30d = logs30d
        self.corrective30d = corrective30d
    }
}

/// Two-stage cooling (CCP-8) — time-based, summarized separately.
/// Mirrors `HaccpCoolingSummary`.
public struct HaccpCoolingSummary: Sendable, Equatable {
    /// Always "CCP-8" (literal in the TS type).
    public let ccpId: String
    public let citation: String
    public let batches30d: Int
    public let breaches30d: Int
    /// Batches still between started_at and stage2_at right now (status='in_progress').
    public let openNow: Int

    public init(ccpId: String = "CCP-8", citation: String, batches30d: Int, breaches30d: Int, openNow: Int) {
        self.ccpId = ccpId
        self.citation = citation
        self.batches30d = batches30d
        self.breaches30d = breaches30d
        self.openNow = openNow
    }
}

/// A non-CCP food-safety program with its citation and evidence count.
/// Mirrors `HaccpRuleModule`.
public struct HaccpRuleModule: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let citation: String
    /// Rows counted per `evidenceLabel` (window logs or current registry).
    public let records: Int
    /// What `records` counts, e.g. "entries in last 30 days".
    public let evidenceLabel: String
    /// True when at least one record exists.
    public let active: Bool

    public init(id: String, name: String, citation: String, records: Int, evidenceLabel: String, active: Bool) {
        self.id = id
        self.name = name
        self.citation = citation
        self.records = records
        self.evidenceLabel = evidenceLabel
        self.active = active
    }
}

/// A corrective-action feed source. Mirrors `CorrectiveActionSource`.
public enum HaccpCorrectiveSource: String, Sendable, Equatable {
    case tempLog = "temp_log"
    case lineCheck = "line_check"
}

/// One merged corrective-action entry. Mirrors `CorrectiveActionEntry`.
public struct HaccpCorrectiveEntry: Sendable, Equatable, Identifiable {
    public let source: HaccpCorrectiveSource
    public let entryId: Int64
    public let shiftDate: String
    public let stationId: String?
    /// Human-readable label of WHAT was off.
    public let subject: String
    /// The corrective-action text itself.
    public let note: String
    public let cookId: String?
    public let createdAt: String

    /// Stable ForEach identity — mirrors web key `${e.source}-${e.entry_id}`.
    public var id: String { "\(source.rawValue)-\(entryId)" }

    public init(
        source: HaccpCorrectiveSource, entryId: Int64, shiftDate: String,
        stationId: String?, subject: String, note: String, cookId: String?, createdAt: String
    ) {
        self.source = source
        self.entryId = entryId
        self.shiftDate = shiftDate
        self.stationId = stationId
        self.subject = subject
        self.note = note
        self.cookId = cookId
        self.createdAt = createdAt
    }
}

/// Corrective-actions section. Mirrors `HaccpCorrectiveSection`.
public struct HaccpCorrectiveSection: Sendable, Equatable {
    public let citation: String
    public let count: Int
    public let entries: [HaccpCorrectiveEntry]

    public init(citation: String, count: Int, entries: [HaccpCorrectiveEntry]) {
        self.citation = citation
        self.count = count
        self.entries = entries
    }
}

/// One thermometer-calibration row from the window.
/// Mirrors `HaccpCalibrationRecord`.
public struct HaccpCalibrationRecord: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let thermometerId: String
    public let method: String
    public let beforeReadingF: Double?
    public let afterReadingF: Double?
    public let passed: Bool
    public let actionTaken: String?
    public let cookId: String?
    public let calibratedAt: String

    public init(
        id: Int64, thermometerId: String, method: String,
        beforeReadingF: Double?, afterReadingF: Double?, passed: Bool,
        actionTaken: String?, cookId: String?, calibratedAt: String
    ) {
        self.id = id
        self.thermometerId = thermometerId
        self.method = method
        self.beforeReadingF = beforeReadingF
        self.afterReadingF = afterReadingF
        self.passed = passed
        self.actionTaken = actionTaken
        self.cookId = cookId
        self.calibratedAt = calibratedAt
    }
}

/// Per-probe status board tile. Mirrors `ProbeSummary` from lib/calibrations.ts.
public enum HaccpProbeStatus: String, Sendable, Equatable {
    case ok
    case dueSoon = "due_soon"
    case overdue
    case failed
    case unknown
}

public struct HaccpProbeSummary: Sendable, Equatable, Identifiable {
    public let thermometerId: String
    public let status: HaccpProbeStatus
    public let lastCalibratedAt: String?
    /// 'ice_point' | 'boiling_point' | 'reference_probe' | nil
    public let lastMethod: String?
    public let lastReadingF: Double?
    public let lastPassed: Bool?
    public let nextDueAt: String?
    public let frequencyDays: Int
    public let total: Int

    public var id: String { thermometerId }

    public init(
        thermometerId: String, status: HaccpProbeStatus, lastCalibratedAt: String?,
        lastMethod: String?, lastReadingF: Double?, lastPassed: Bool?,
        nextDueAt: String?, frequencyDays: Int, total: Int
    ) {
        self.thermometerId = thermometerId
        self.status = status
        self.lastCalibratedAt = lastCalibratedAt
        self.lastMethod = lastMethod
        self.lastReadingF = lastReadingF
        self.lastPassed = lastPassed
        self.nextDueAt = nextDueAt
        self.frequencyDays = frequencyDays
        self.total = total
    }
}

/// Calibration section. Mirrors `HaccpCalibrationSection`.
public struct HaccpCalibrationSection: Sendable, Equatable {
    public let citation: String
    public let frequencyDaysDefault: Int
    public let records: [HaccpCalibrationRecord]
    /// Current per-probe status board (all history, not just the window).
    public let probes: [HaccpProbeSummary]

    public init(citation: String, frequencyDaysDefault: Int, records: [HaccpCalibrationRecord], probes: [HaccpProbeSummary]) {
        self.citation = citation
        self.frequencyDaysDefault = frequencyDaysDefault
        self.records = records
        self.probes = probes
    }
}

/// The assembled inspector-ready plan. Mirrors `HaccpPlan`.
public struct HaccpPlan: Sendable, Equatable {
    public let locationId: String
    /// Date the plan covers through (YYYY-MM-DD).
    public let planDate: String
    /// First date included in the 30-day evidence window.
    public let windowStart: String
    public let windowDays: Int
    public let generatedAt: String
    public let ccps: [HaccpPlanCcp]
    public let cooling: HaccpCoolingSummary
    public let ruleModules: [HaccpRuleModule]
    public let correctiveActions: HaccpCorrectiveSection
    public let calibrations: HaccpCalibrationSection

    public init(
        locationId: String, planDate: String, windowStart: String, windowDays: Int,
        generatedAt: String, ccps: [HaccpPlanCcp], cooling: HaccpCoolingSummary,
        ruleModules: [HaccpRuleModule], correctiveActions: HaccpCorrectiveSection,
        calibrations: HaccpCalibrationSection
    ) {
        self.locationId = locationId
        self.planDate = planDate
        self.windowStart = windowStart
        self.windowDays = windowDays
        self.generatedAt = generatedAt
        self.ccps = ccps
        self.cooling = cooling
        self.ruleModules = ruleModules
        self.correctiveActions = correctiveActions
        self.calibrations = calibrations
    }
}

// MARK: - Raw GRDB row types (repository SELECTs into these)

/// `temp_log` grouped counts per point over the window.
/// SQL: GROUP BY point_id, COUNT(*) AS logs, SUM(corrective) AS corrective.
public struct HaccpTempCountRow: Codable, FetchableRecord, Sendable {
    public let pointId: String
    public let logs: Int
    public let corrective: Int

    enum CodingKeys: String, CodingKey {
        case pointId = "point_id"
        case logs
        case corrective
    }

    public init(pointId: String, logs: Int, corrective: Int) {
        self.pointId = pointId
        self.logs = logs
        self.corrective = corrective
    }
}

/// The single cooling_log summary row (COUNT / SUM over the window).
public struct HaccpCoolingRow: Codable, FetchableRecord, Sendable {
    public let batches: Int
    public let breaches: Int?
    public let openNow: Int?

    enum CodingKeys: String, CodingKey {
        case batches
        case breaches
        case openNow = "open_now"
    }

    public init(batches: Int, breaches: Int?, openNow: Int?) {
        self.batches = batches
        self.breaches = breaches
        self.openNow = openNow
    }
}

/// A `temp_log` corrective row (non-empty corrective_action) in the window.
public struct HaccpTempLogCorrectiveRow: Codable, FetchableRecord, Sendable {
    public let id: Int64
    public let shiftDate: String
    public let pointId: String
    public let correctiveAction: String
    public let cookId: String?
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case pointId = "point_id"
        case correctiveAction = "corrective_action"
        case cookId = "cook_id"
        case createdAt = "created_at"
    }

    public init(id: Int64, shiftDate: String, pointId: String, correctiveAction: String, cookId: String?, createdAt: String) {
        self.id = id
        self.shiftDate = shiftDate
        self.pointId = pointId
        self.correctiveAction = correctiveAction
        self.cookId = cookId
        self.createdAt = createdAt
    }
}

/// A `line_check_entries` corrective row (status='fail', non-empty note) in the window.
public struct HaccpLineCheckCorrectiveRow: Codable, FetchableRecord, Sendable {
    public let id: Int64
    public let shiftDate: String
    public let stationId: String
    public let item: String
    public let note: String
    public let cookId: String?
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case shiftDate = "shift_date"
        case stationId = "station_id"
        case item
        case note
        case cookId = "cook_id"
        case createdAt = "created_at"
    }

    public init(id: Int64, shiftDate: String, stationId: String, item: String, note: String, cookId: String?, createdAt: String) {
        self.id = id
        self.shiftDate = shiftDate
        self.stationId = stationId
        self.item = item
        self.note = note
        self.cookId = cookId
        self.createdAt = createdAt
    }
}

/// A `thermometer_calibrations` window record (full row for the records table).
public struct HaccpCalibrationWindowRow: Codable, FetchableRecord, Sendable {
    public let id: Int64
    public let thermometerId: String
    public let method: String
    public let beforeReadingF: Double?
    public let afterReadingF: Double?
    public let passed: Int
    public let actionTaken: String?
    public let cookId: String?
    public let calibratedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case thermometerId = "thermometer_id"
        case method
        case beforeReadingF = "before_reading_f"
        case afterReadingF = "after_reading_f"
        case passed
        case actionTaken = "action_taken"
        case cookId = "cook_id"
        case calibratedAt = "calibrated_at"
    }

    public init(id: Int64, thermometerId: String, method: String, beforeReadingF: Double?, afterReadingF: Double?, passed: Int, actionTaken: String?, cookId: String?, calibratedAt: String) {
        self.id = id
        self.thermometerId = thermometerId
        self.method = method
        self.beforeReadingF = beforeReadingF
        self.afterReadingF = afterReadingF
        self.passed = passed
        self.actionTaken = actionTaken
        self.cookId = cookId
        self.calibratedAt = calibratedAt
    }
}

/// A `thermometer_calibrations` row for the probe-status classifier (all history).
public struct HaccpProbeCalibrationRow: Codable, FetchableRecord, Sendable {
    public let thermometerId: String
    public let method: String
    public let beforeReadingF: Double?
    public let passed: Int
    public let calibratedAt: String
    public let frequencyDays: Int?

    enum CodingKeys: String, CodingKey {
        case thermometerId = "thermometer_id"
        case method
        case beforeReadingF = "before_reading_f"
        case passed
        case calibratedAt = "calibrated_at"
        case frequencyDays = "frequency_days"
    }

    public init(thermometerId: String, method: String, beforeReadingF: Double?, passed: Int, calibratedAt: String, frequencyDays: Int?) {
        self.thermometerId = thermometerId
        self.method = method
        self.beforeReadingF = beforeReadingF
        self.passed = passed
        self.calibratedAt = calibratedAt
        self.frequencyDays = frequencyDays
    }
}

// MARK: - Raw bundle (repository → compute)

/// Everything HaccpPlanCompute needs to assemble a plan. The repository packs
/// this from location-scoped SELECTs; the compute layer does the pure assembly.
public struct HaccpPlanBundle: Sendable {
    public let locationId: String
    public let tempCounts: [HaccpTempCountRow]
    public let coolingRow: HaccpCoolingRow?
    /// Per-module window counts keyed by module id (receiving, date_marking, …).
    public let moduleCounts: [String: Int]
    public let sdsActive: Int
    public let tempLogCorrective: [HaccpTempLogCorrectiveRow]
    public let lineCheckCorrective: [HaccpLineCheckCorrectiveRow]
    public let calibrationWindow: [HaccpCalibrationWindowRow]
    public let allCalibrations: [HaccpProbeCalibrationRow]

    public init(
        locationId: String,
        tempCounts: [HaccpTempCountRow],
        coolingRow: HaccpCoolingRow?,
        moduleCounts: [String: Int],
        sdsActive: Int,
        tempLogCorrective: [HaccpTempLogCorrectiveRow],
        lineCheckCorrective: [HaccpLineCheckCorrectiveRow],
        calibrationWindow: [HaccpCalibrationWindowRow],
        allCalibrations: [HaccpProbeCalibrationRow]
    ) {
        self.locationId = locationId
        self.tempCounts = tempCounts
        self.coolingRow = coolingRow
        self.moduleCounts = moduleCounts
        self.sdsActive = sdsActive
        self.tempLogCorrective = tempLogCorrective
        self.lineCheckCorrective = lineCheckCorrective
        self.calibrationWindow = calibrationWindow
        self.allCalibrations = allCalibrations
    }
}
