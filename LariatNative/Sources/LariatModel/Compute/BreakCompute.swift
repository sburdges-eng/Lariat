import Foundation

/// Port of `lib/breaks.ts` — COMPS #39 shift evaluation.
public enum BreakCompute {
    public static let restBreakMinMinutes = 10
    public static let mealBreakMinMinutes = 30
    public static let restBreakWorkBlockHours = 4
    public static let mealBreakThresholdHours = 5.0

    public struct ShiftBreakInput: Sendable {
        public let kind: BreakKind
        public let startedAt: String
        public let endedAt: String?
        public let durationMin: Double?
        public let waived: Bool

        public init(kind: BreakKind, startedAt: String, endedAt: String?, durationMin: Double?, waived: Bool) {
            self.kind = kind
            self.startedAt = startedAt
            self.endedAt = endedAt
            self.durationMin = durationMin
            self.waived = waived
        }
    }

    public struct ShiftEvaluation: Sendable, Equatable {
        public let shiftHours: Double
        public let requiredMealBreaks: Int
        public let requiredRestBreaks: Int
        public let actualMealBreaks: Int
        public let actualRestBreaks: Int
        public let waivedMealBreaks: Int
        public let mealBreaksOwed: Int
        public let restBreaksOwed: Int
        public let shortMealBreaks: Int
        public let shortRestBreaks: Int
        public let warnings: [String]
    }

    public static func requiredRestBreaks(shiftHours: Double) -> Int {
        guard shiftHours.isFinite, shiftHours > 0 else { return 0 }
        return Int(floor((shiftHours + 2.0) / Double(restBreakWorkBlockHours)))
    }

    public static func requiresMealBreak(shiftHours: Double) -> Bool {
        shiftHours.isFinite && shiftHours >= mealBreakThresholdHours
    }

    public static func evaluateShift(
        shiftStartedAt: String,
        shiftEndedAt: String,
        breaks: [ShiftBreakInput]
    ) -> ShiftEvaluation {
        var warnings: [String] = []
        guard let startMs = parseIso(shiftStartedAt),
              let endMs = parseIso(shiftEndedAt),
              endMs > startMs else {
            return ShiftEvaluation(
                shiftHours: 0,
                requiredMealBreaks: 0,
                requiredRestBreaks: 0,
                actualMealBreaks: 0,
                actualRestBreaks: 0,
                waivedMealBreaks: 0,
                mealBreaksOwed: 0,
                restBreaksOwed: 0,
                shortMealBreaks: 0,
                shortRestBreaks: 0,
                warnings: ["Invalid shift timestamps — check clock-in/clock-out"]
            )
        }

        let shiftHours = (endMs - startMs) / 3_600_000.0
        let reqRest = requiredRestBreaks(shiftHours: shiftHours)
        let reqMeal = requiresMealBreak(shiftHours: shiftHours) ? 1 : 0

        var actualMeal = 0
        var actualRest = 0
        var waivedMeal = 0
        var shortMeal = 0
        var shortRest = 0

        for b in breaks {
            if b.kind == .meal {
                if b.waived {
                    waivedMeal += 1
                    continue
                }
                guard let d = durationMin(b) else {
                    warnings.append("Open meal break with no end time")
                    continue
                }
                if d < Double(mealBreakMinMinutes) {
                    shortMeal += 1
                } else {
                    actualMeal += 1
                }
            } else {
                guard let d = durationMin(b) else {
                    warnings.append("Open rest break with no end time")
                    continue
                }
                if d < Double(restBreakMinMinutes) {
                    shortRest += 1
                } else {
                    actualRest += 1
                }
            }
        }

        let effectiveMeals = actualMeal + waivedMeal
        let mealOwed = max(0, reqMeal - effectiveMeals)
        let restOwed = max(0, reqRest - actualRest)

        if shortMeal > 0 {
            warnings.append("\(shortMeal) meal break(s) under 30 min — not compliant; may owe pay")
        }
        if shortRest > 0 {
            warnings.append("\(shortRest) rest break(s) under 10 min — not compliant; owes pay")
        }
        if waivedMeal > 0 && reqMeal == 0 {
            warnings.append("Meal break waived on a shift that did not require one")
        }

        return ShiftEvaluation(
            shiftHours: shiftHours,
            requiredMealBreaks: reqMeal,
            requiredRestBreaks: reqRest,
            actualMealBreaks: actualMeal,
            actualRestBreaks: actualRest,
            waivedMealBreaks: waivedMeal,
            mealBreaksOwed: mealOwed,
            restBreaksOwed: restOwed,
            shortMealBreaks: shortMeal,
            shortRestBreaks: shortRest,
            warnings: warnings
        )
    }

    private static func parseIso(_ s: String) -> Double? {
        if let d = ISO8601DateFormatter().date(from: s) { return d.timeIntervalSince1970 * 1000 }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        if let d = f.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        let ms = DateFormatter.iso8601NoFrac.date(from: s)
        return ms.map { $0.timeIntervalSince1970 * 1000 }
    }

    private static func durationMin(_ b: ShiftBreakInput) -> Double? {
        if let d = b.durationMin, d.isFinite { return d }
        guard let ended = b.endedAt,
              let a = parseIso(b.startedAt),
              let c = parseIso(ended) else { return nil }
        return (c - a) / 60_000.0
    }
}

private extension DateFormatter {
    static let iso8601NoFrac: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()
}
