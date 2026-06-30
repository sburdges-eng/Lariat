import Foundation

// Port of `lib/cooling.ts` — two-stage cooling (FDA Food Code 2022 §3-501.14),
// CCP-8. TCS food cooled from 135°F must reach 70°F within 2h (stage 1) and 41°F
// within 4h MORE (6h total). Either leg missed = breach. This module is pure
// (no I/O); the repository wraps it with DB writes. Numbers/citations match the
// JS rule module exactly — see tests/js/test-cooling-rules.mjs for the pins.

/// A breach reason — mirrors the JS `BreachReason` string union. Raw values match
/// the strings the web writes to `cooling_log.breach_reason`.
public enum CoolingBreachReason: String, Sendable, Equatable {
    case stage1Over2h = "stage1_over_2h"
    case stage2Over4h = "stage2_over_4h"
    case stage1ReadingAbove70 = "stage1_reading_above_70"
    case stage2ReadingAbove41 = "stage2_reading_above_41"
    case discarded
    case staleOpen = "stale_open"
}

/// Per-reading status — mirrors the JS decision `status` field.
public enum CoolingStageStatus: String, Sendable, Equatable {
    case inProgress = "in_progress"
    case ok
    case breach
}

/// Result of `classifyCoolingStage`. `.decided` carries the stage close outcome;
/// `.invalid` is a validation error (the web returns 400 for these).
public enum CoolingStageDecision: Sendable, Equatable {
    case decided(stage: Int, status: CoolingStageStatus, breachReason: CoolingBreachReason?, minutesElapsed: Double)
    case invalid(reason: String)
}

/// Validation outcome for opening a batch — mirrors the JS `ValidateResult`.
public struct ValidateCoolingResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?

    public static let success = ValidateCoolingResult(ok: true, reason: nil)
    public static func failure(_ reason: String) -> ValidateCoolingResult {
        ValidateCoolingResult(ok: false, reason: reason)
    }
}

/// Minimal row view for the open-batch scanner (mirrors the JS `Pick<>` shape).
public struct CoolingScanRow: Sendable, Equatable {
    public let id: Int64
    public let item: String
    public let startedAt: String
    public let stage1At: String?
    public let status: String

    public init(id: Int64, item: String, startedAt: String, stage1At: String?, status: String) {
        self.id = id
        self.item = item
        self.startedAt = startedAt
        self.stage1At = stage1At
        self.status = status
    }
}

public enum CoolingCompute {
    // Phase-1 ceiling: food must be AT or BELOW this to close stage 1.
    public static let stage1CeilingF: Double = 70
    // Phase-2 ceiling: food must be AT or BELOW this to close stage 2.
    public static let stage2CeilingF: Double = 41

    // Hour budgets per FDA §3-501.14(A).
    public static let stage1MaxMinutes: Int = 2 * 60       // 120 min from started_at
    public static let stage2MaxMinutes: Int = 4 * 60       // 240 min from stage1_at
    public static let totalMaxMinutes: Int = stage1MaxMinutes + stage2MaxMinutes   // 360

    // Absolute sanity range for readings (broken probe / typo guard).
    static let absoluteMinF: Double = -100
    static let absoluteMaxF: Double = 500

    public static let correctiveNoteMaxLength = 500

    // ── ISO-8601 parsing (parity with JS Date.parse for the inputs we accept) ──

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Parse an ISO-8601 timestamp to ms-since-epoch, or nil on a rejected parse.
    /// Accepts both fractional (`.000Z`) and non-fractional forms.
    public static func parseIsoMs(_ ts: String?) -> Double? {
        guard let ts, !ts.isEmpty else { return nil }
        if let d = isoNoFraction.date(from: ts) { return d.timeIntervalSince1970 * 1000 }
        if let d = isoWithFraction.date(from: ts) { return d.timeIntervalSince1970 * 1000 }
        return nil
    }

    private static func minutesBetween(_ a: String?, _ b: String?) -> Double? {
        guard let ta = parseIsoMs(a), let tb = parseIsoMs(b) else { return nil }
        return (tb - ta) / 60000
    }

    static func isFiniteReading(_ f: Double) -> Bool {
        f.isFinite && f >= absoluteMinF && f <= absoluteMaxF
    }

    // ── Starting a cooling batch ──────────────────────────────────────

    /// Mirror of `validateCoolingStart`. `startReadingF` may be nil (cook probes
    /// at stage 1) — only out-of-range/non-finite readings fail.
    public static func validateCoolingStart(item: String, startedAt: String, startReadingF: Double?) -> ValidateCoolingResult {
        if item.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .failure("Item name is required")
        }
        if parseIsoMs(startedAt) == nil {
            return .failure("started_at must be an ISO timestamp")
        }
        if let reading = startReadingF {
            if !isFiniteReading(reading) {
                return .failure("start_reading_f is off the charts — check the probe")
            }
        }
        return .success
    }

    // ── Recording a stage reading ─────────────────────────────────────

    /// Mirror of `classifyCoolingStage`. `stage1At` nil ⇒ stage 1 still open.
    public static func classifyCoolingStage(
        startedAt: String,
        stage1At: String?,
        status: String,
        readingF: Double,
        at: String
    ) -> CoolingStageDecision {
        if !isFiniteReading(readingF) {
            return .invalid(reason: "Reading must be a finite °F number")
        }
        if parseIsoMs(at) == nil {
            return .invalid(reason: "Reading timestamp must be ISO 8601")
        }
        if status != "in_progress" {
            return .invalid(reason: "Cooling batch already closed (status=\(status))")
        }

        // Stage 1 hasn't closed yet.
        if stage1At == nil || (stage1At?.isEmpty ?? true) {
            guard let elapsed = minutesBetween(startedAt, at) else {
                return .invalid(reason: "Cannot compute elapsed time — batch started_at is not a valid ISO timestamp")
            }
            if elapsed < 0 {
                return .invalid(reason: "Reading is before the batch start time")
            }

            // Reading still above 70: stays in progress unless the clock ran out.
            if readingF > stage1CeilingF {
                if elapsed > Double(stage1MaxMinutes) {
                    return .decided(stage: 1, status: .breach, breachReason: .stage1Over2h, minutesElapsed: elapsed)
                }
                return .decided(stage: 1, status: .inProgress, breachReason: nil, minutesElapsed: elapsed)
            }

            // Reading ≤ 70: closes stage 1. Still a breach if over 2h.
            if elapsed > Double(stage1MaxMinutes) {
                return .decided(stage: 1, status: .breach, breachReason: .stage1Over2h, minutesElapsed: elapsed)
            }
            // Stage 1 closed, stage 2 still open.
            return .decided(stage: 1, status: .inProgress, breachReason: nil, minutesElapsed: elapsed)
        }

        // Stage 1 already closed — closing stage 2.
        guard let stage2Elapsed = minutesBetween(stage1At, at), stage2Elapsed >= 0 else {
            return .invalid(reason: "Reading is before the stage-1 timestamp")
        }

        if readingF > stage2CeilingF {
            if stage2Elapsed > Double(stage2MaxMinutes) {
                return .decided(stage: 2, status: .breach, breachReason: .stage2Over4h, minutesElapsed: stage2Elapsed)
            }
            return .decided(stage: 2, status: .inProgress, breachReason: nil, minutesElapsed: stage2Elapsed)
        }

        // Reading ≤ 41: closes stage 2. Breach if over 4h from stage1.
        if stage2Elapsed > Double(stage2MaxMinutes) {
            return .decided(stage: 2, status: .breach, breachReason: .stage2Over4h, minutesElapsed: stage2Elapsed)
        }
        return .decided(stage: 2, status: .ok, breachReason: nil, minutesElapsed: stage2Elapsed)
    }

    // ── Open-batch scanner (for the dashboard) ────────────────────────

    /// Mirror of `scanOpenBatches`. `nowMs` is a param so tests can freeze time.
    public static func scanOpenBatches(_ rows: [CoolingScanRow], nowMs: Double) -> [CoolingScanEntry] {
        var out: [CoolingScanEntry] = []
        for r in rows {
            if r.status != "in_progress" { continue }
            guard let started = parseIsoMs(r.startedAt) else { continue }

            if r.stage1At == nil || (r.stage1At?.isEmpty ?? true) {
                let elapsedMin = (nowMs - started) / 60000
                let remaining = Double(stage1MaxMinutes) - elapsedMin
                out.append(CoolingScanEntry(
                    id: r.id, item: r.item, startedAt: r.startedAt,
                    stage: 1, minutesRemaining: remaining, breached: remaining < 0))
            } else {
                guard let s1 = parseIsoMs(r.stage1At) else { continue }
                let elapsedMin = (nowMs - s1) / 60000
                let remaining = Double(stage2MaxMinutes) - elapsedMin
                out.append(CoolingScanEntry(
                    id: r.id, item: r.item, startedAt: r.startedAt,
                    stage: 2, minutesRemaining: remaining, breached: remaining < 0))
            }
        }
        return out
    }

    /// Convenience scan over full rows (used by the repository board snapshot).
    public static func scanOpenBatches(_ rows: [CoolingRow], nowMs: Double) -> [CoolingScanEntry] {
        scanOpenBatches(rows.map {
            CoolingScanRow(id: $0.id, item: $0.item, startedAt: $0.startedAt, stage1At: $0.stage1At, status: $0.status)
        }, nowMs: nowMs)
    }

    /// Normalize a corrective note: trim, nil when empty.
    public static func normalizeCorrectiveAction(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
