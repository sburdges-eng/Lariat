import Foundation

// Port of `lib/tempLog.ts` — validation, classification, and board summaries.
// `redBreachCount` remains for Command food-safety breach tile (expectAllPoints: false).

public struct TempPoint: Sendable, Equatable {
    public let id: String
    public let label: String
    public let ccpId: String
    public let requiredMinF: Double?
    public let requiredMaxF: Double?
    public let citation: String
}

public enum TempReadingClass: String, Sendable {
    case ok
    case outOfRange = "out_of_range"
    case invalid
}

public enum TempTileStatus: String, Sendable {
    case green, yellow, red, gray
}

public struct ValidateTempResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?

    public static let success = ValidateTempResult(ok: true, reason: nil)

    public static func failure(_ reason: String) -> ValidateTempResult {
        ValidateTempResult(ok: false, reason: reason)
    }
}

public struct TempLogReadingRow: Sendable {
    public let pointId: String
    public let readingF: Double
    public let correctiveAction: String?
    public let createdAt: String?

    public init(pointId: String, readingF: Double, correctiveAction: String? = nil, createdAt: String? = nil) {
        self.pointId = pointId
        self.readingF = readingF
        self.correctiveAction = correctiveAction
        self.createdAt = createdAt
    }
}

public struct TempPointSummary: Sendable, Identifiable {
    public var id: String { pointId }
    public let pointId: String
    public let label: String
    public let ccpId: String
    public let citation: String
    public let requiredMinF: Double?
    public let requiredMaxF: Double?
    public let status: TempTileStatus
    public let totalReadings: Int
    public let okCount: Int
    public let correctiveCount: Int
    public let criticalCount: Int
    public let invalidCount: Int
    public let lastReadingF: Double?
    public let lastReadingAt: String?
}

public struct TempLogEntryDraft: Sendable {
    public let shiftDate: String
    public let locationId: String
    public let pointId: String
    public let readingF: Double
    public let requiredMinF: Double?
    public let requiredMaxF: Double?
    public let correctiveAction: String?
    public let cookId: String?
    public let probeId: String?
}

public enum TempLogCompute {
    public static let absoluteMinF = -100.0
    public static let absoluteMaxF = 500.0
    public static let correctiveNoteMaxLength = 500

    public static let points: [TempPoint] = [
        TempPoint(id: "receiving_cold", label: "Cold delivery", ccpId: "CCP-1",
                  requiredMinF: nil, requiredMaxF: 41,
                  citation: "FDA §3-202.11 — refrigerated PHF/TCS received at ≤ 41°F"),
        TempPoint(id: "receiving_frozen", label: "Frozen delivery", ccpId: "CCP-1",
                  requiredMinF: nil, requiredMaxF: 10,
                  citation: "FDA §3-202.11 — frozen food received frozen (≤ 10°F practical)"),
        TempPoint(id: "walk_in_cooler", label: "Walk-in cooler", ccpId: "CCP-2",
                  requiredMinF: nil, requiredMaxF: 41,
                  citation: "FDA §3-501.16(A)(2) — TCS food cold-hold ≤ 41°F"),
        TempPoint(id: "reach_in_cooler", label: "Reach-in cooler", ccpId: "CCP-2",
                  requiredMinF: nil, requiredMaxF: 41,
                  citation: "FDA §3-501.16(A)(2) — TCS food cold-hold ≤ 41°F"),
        TempPoint(id: "freezer", label: "Freezer", ccpId: "CCP-3",
                  requiredMinF: nil, requiredMaxF: 0,
                  citation: "FDA §3-501.16(A)(1) — frozen storage"),
        TempPoint(id: "cook_poultry", label: "Cook — poultry", ccpId: "CCP-4",
                  requiredMinF: 165, requiredMaxF: nil,
                  citation: "FDA §3-401.11(A)(3) — poultry min-internal 165°F / 15s"),
        TempPoint(id: "cook_ground_beef", label: "Cook — ground beef", ccpId: "CCP-5",
                  requiredMinF: 155, requiredMaxF: nil,
                  citation: "FDA §3-401.11(A)(2) — comminuted meat min-internal 155°F / 15s"),
        TempPoint(id: "cook_fish", label: "Cook — fish", ccpId: "CCP-6",
                  requiredMinF: 145, requiredMaxF: nil,
                  citation: "FDA §3-401.11(A)(1) — fish min-internal 145°F / 15s"),
        TempPoint(id: "cook_pork", label: "Cook — pork", ccpId: "CCP-6",
                  requiredMinF: 145, requiredMaxF: nil,
                  citation: "FDA §3-401.11(A)(1) — whole-muscle pork 145°F / 15s"),
        TempPoint(id: "cook_beef_steak", label: "Cook — beef steak", ccpId: "CCP-6",
                  requiredMinF: 145, requiredMaxF: nil,
                  citation: "FDA §3-401.11(A)(1) — whole-muscle beef 145°F / 15s"),
        TempPoint(id: "cook_eggs", label: "Cook — shell eggs", ccpId: "CCP-5e",
                  requiredMinF: 155, requiredMaxF: nil,
                  citation: "FDA §3-401.11(A)(2) — shell eggs for hot-hold 155°F / 15s"),
        TempPoint(id: "hot_hold", label: "Hot hold", ccpId: "CCP-7",
                  requiredMinF: 140, requiredMaxF: nil,
                  citation: "FDA §3-501.16(A)(1) — hot-hold ≥ 135°F; house floor raised to 140°F"),
        TempPoint(id: "reheat", label: "Reheat", ccpId: "CCP-9",
                  requiredMinF: 165, requiredMaxF: nil,
                  citation: "FDA §3-403.11(A) — reheat for hot-hold 165°F / 15s within 2h"),
    ]

    private static let byID: [String: TempPoint] =
        Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0) })

    public static func getTempPoint(_ id: String) -> TempPoint? {
        byID[id]
    }

    public static func normalizeCorrectiveAction(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public static func classifyReading(_ point: TempPoint, _ readingF: Double) -> TempReadingClass {
        guard readingF.isFinite else { return .invalid }
        if readingF < absoluteMinF || readingF > absoluteMaxF { return .invalid }
        if let min = point.requiredMinF, readingF < min { return .outOfRange }
        if let max = point.requiredMaxF, readingF > max { return .outOfRange }
        return .ok
    }

    public static func validateTempReading(
        point: TempPoint,
        readingF: Double,
        correctiveAction: String?
    ) -> ValidateTempResult {
        guard readingF.isFinite else {
            return .failure("Reading must be a number in °F")
        }
        if readingF < absoluteMinF || readingF > absoluteMaxF {
            return .failure("Reading \(readingF)°F is off the charts — check the probe")
        }

        let belowMin = point.requiredMinF.map { readingF < $0 } ?? false
        let aboveMax = point.requiredMaxF.map { readingF > $0 } ?? false
        if !belowMin && !aboveMax {
            return .success
        }

        if normalizeCorrectiveAction(correctiveAction) == nil {
            if belowMin, let min = point.requiredMinF {
                return .failure("\(point.label) is \(readingF)°F (below limit \(min)°F) — needs a note on the fix")
            }
            if aboveMax, let max = point.requiredMaxF {
                return .failure("\(point.label) is \(readingF)°F (above limit \(max)°F) — needs a note on the fix")
            }
        }
        return .success
    }

    /// Throws `RuleGateError` when validation fails (422 vs 400 disambiguation).
    public static func enforceTempReading(
        point: TempPoint,
        readingF: Double,
        correctiveAction: String?
    ) throws {
        if let note = correctiveAction, note.count > correctiveNoteMaxLength {
            throw RuleGateError.correctiveNoteTooLong(length: note.count)
        }
        let result = validateTempReading(point: point, readingF: readingF, correctiveAction: correctiveAction)
        guard result.ok else {
            let reason = result.reason ?? "Invalid reading"
            if classifyReading(point, readingF) == .outOfRange {
                throw RuleGateError.needsCorrectiveAction(pointId: point.id, reason: reason)
            }
            throw RuleGateError.validationFailed(reason)
        }
    }

    public static func entryFromReading(
        point: TempPoint,
        readingF: Double,
        correctiveAction: String?,
        shiftDate: String,
        cookId: String?,
        locationId: String = LocationScope.resolve(),
        probeId: String? = nil
    ) -> TempLogEntryDraft {
        TempLogEntryDraft(
            shiftDate: shiftDate,
            locationId: locationId,
            pointId: point.id,
            readingF: readingF,
            requiredMinF: point.requiredMinF,
            requiredMaxF: point.requiredMaxF,
            correctiveAction: normalizeCorrectiveAction(correctiveAction),
            cookId: cookId,
            probeId: probeId
        )
    }

    public static func classifyReadings(
        _ readings: [TempLogReadingRow],
        expectAllPoints: Bool = true
    ) -> [TempPointSummary] {
        var grouped: [String: [TempLogReadingRow]] = [:]
        for row in readings {
            guard getTempPoint(row.pointId) != nil else { continue }
            grouped[row.pointId, default: []].append(row)
        }

        let pointIds = expectAllPoints ? points.map(\.id) : Array(grouped.keys)
        var out: [TempPointSummary] = []
        for id in pointIds {
            guard let point = getTempPoint(id) else { continue }
            let rows = grouped[id] ?? []
            var ok = 0, corrective = 0, critical = 0, invalid = 0
            var newest: TempLogReadingRow?
            for row in rows {
                if newest == nil || (row.createdAt ?? "") > (newest?.createdAt ?? "") {
                    newest = row
                }
                switch classifyReading(point, row.readingF) {
                case .invalid: invalid += 1
                case .ok: ok += 1
                case .outOfRange:
                    if normalizeCorrectiveAction(row.correctiveAction) != nil { corrective += 1 }
                    else { critical += 1 }
                }
            }
            let status: TempTileStatus
            if critical > 0 || (!rows.isEmpty && ok == 0 && corrective == 0 && invalid > 0) {
                status = .red
            } else if corrective > 0 {
                status = .yellow
            } else if ok > 0 {
                status = .green
            } else {
                status = .gray
            }
            out.append(
                TempPointSummary(
                    pointId: point.id,
                    label: point.label,
                    ccpId: point.ccpId,
                    citation: point.citation,
                    requiredMinF: point.requiredMinF,
                    requiredMaxF: point.requiredMaxF,
                    status: status,
                    totalReadings: rows.count,
                    okCount: ok,
                    correctiveCount: corrective,
                    criticalCount: critical,
                    invalidCount: invalid,
                    lastReadingF: newest?.readingF,
                    lastReadingAt: newest?.createdAt
                )
            )
        }
        return out
    }

    /// Command breach count — `classifyReadings(..., expectAllPoints:false)` red tiles only.
    public static func redBreachCount(_ rows: [CmdTempLogRow]) -> Int {
        let readings = rows.compactMap { row -> TempLogReadingRow? in
            guard let pid = row.pointId, let reading = row.readingF else { return nil }
            return TempLogReadingRow(
                pointId: pid,
                readingF: reading,
                correctiveAction: row.correctiveAction,
                createdAt: row.createdAt
            )
        }
        return classifyReadings(readings, expectAllPoints: false)
            .filter { $0.status == .red }
            .count
    }
}
