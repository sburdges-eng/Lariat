import Foundation

public enum ReviewStatus: String, Sendable, Codable {
    case green
    case amber
    case red
    case gray
}

public struct ReviewClassification: Sendable, Equatable {
    public let averageScore: Double
    public let status: ReviewStatus
    public let label: String

    public init(averageScore: Double, status: ReviewStatus, label: String) {
        self.averageScore = averageScore
        self.status = status
        self.label = label
    }
}

public struct PerformanceReviewScores: Sendable, Equatable {
    public let punctualityScore: Int
    public let techniqueScore: Int
    public let speedScore: Int

    public init(punctualityScore: Int, techniqueScore: Int, speedScore: Int) {
        self.punctualityScore = punctualityScore
        self.techniqueScore = techniqueScore
        self.speedScore = speedScore
    }
}

/// Parity with `lib/performanceReviews.ts`.
public enum PerformanceReviewCompute {
    public static func classifyReview(_ input: PerformanceReviewScores) -> ReviewClassification {
        let scores = [input.punctualityScore, input.techniqueScore, input.speedScore]
            .filter { $0 > 0 }

        guard !scores.isEmpty else {
            return ReviewClassification(averageScore: 0, status: .gray, label: "No scores")
        }

        let avg = Double(scores.reduce(0, +)) / Double(scores.count)
        var status: ReviewStatus = .amber
        var label = "Solid"

        if avg >= 4 {
            status = .green
            label = avg >= 4.5 ? "Exceptional" : "Great"
        } else if avg < 2.5 {
            status = .red
            label = "Needs Improvement"
        } else if avg >= 3 {
            label = "Good"
        }

        let rounded = (avg * 10).rounded() / 10
        return ReviewClassification(averageScore: rounded, status: status, label: label)
    }

    /// Returns a user-facing error message, or nil when valid.
    public static func validateScores(_ input: PerformanceReviewScores) -> String? {
        let checks: [(Int, String)] = [
            (input.punctualityScore, "On Time"),
            (input.techniqueScore, "Technique"),
            (input.speedScore, "Speed"),
        ]
        for (value, name) in checks {
            if value < 1 || value > 5 {
                return "\(name) score must be between 1 and 5."
            }
        }
        return nil
    }
}
