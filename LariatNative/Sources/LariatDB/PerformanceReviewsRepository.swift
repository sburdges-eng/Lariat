import Foundation
import GRDB
import LariatModel

public struct PerformanceReviewRow: Decodable, FetchableRecord, Sendable, Identifiable {
    public let id: Int64
    public let cookName: String
    public let cookUuid: String?
    public let reviewDate: String
    public let punctualityScore: Int?
    public let techniqueScore: Int?
    public let speedScore: Int?
    public let notes: String?
    public let reviewerName: String
    public let locationId: String
    public let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case cookName = "cook_name"
        case cookUuid = "cook_uuid"
        case reviewDate = "review_date"
        case punctualityScore = "punctuality_score"
        case techniqueScore = "technique_score"
        case speedScore = "speed_score"
        case notes
        case reviewerName = "reviewer_name"
        case locationId = "location_id"
        case createdAt = "created_at"
    }
}

public struct PerformanceReviewCreateInput: Sendable {
    public let cookName: String
    public let cookUuid: String?
    public let reviewDate: String
    public let punctualityScore: Int
    public let techniqueScore: Int
    public let speedScore: Int
    public let notes: String?
    public let reviewerName: String
    public let locationId: String

    public init(
        cookName: String,
        cookUuid: String?,
        reviewDate: String,
        punctualityScore: Int,
        techniqueScore: Int,
        speedScore: Int,
        notes: String?,
        reviewerName: String,
        locationId: String
    ) {
        self.cookName = cookName
        self.cookUuid = cookUuid
        self.reviewDate = reviewDate
        self.punctualityScore = punctualityScore
        self.techniqueScore = techniqueScore
        self.speedScore = speedScore
        self.notes = notes
        self.reviewerName = reviewerName
        self.locationId = locationId
    }
}

public enum PerformanceReviewWriteError: Error, LocalizedError {
    case missingRequiredFields
    case invalidScores(String)

    public var errorDescription: String? {
        switch self {
        case .missingRequiredFields:
            return "Missing required fields"
        case .invalidScores(let message):
            return message
        }
    }
}

public struct PerformanceReviewsRepository {
    private let database: LariatWriteDatabase
    private let auditLogger: ManagementAuditLogger

    public init(database: LariatWriteDatabase, auditLogger: ManagementAuditLogger? = nil) {
        self.database = database
        self.auditLogger = auditLogger ?? ManagementAuditLogger(auditPath: resolveManagementAuditPath())
    }

    public func list(locationId: String) throws -> [PerformanceReviewRow] {
        try database.pool.read { db in
            try PerformanceReviewRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM performance_reviews
                  WHERE location_id = ?
                  ORDER BY review_date DESC, id DESC
                  """,
                arguments: [locationId]
            )
        }
    }

    /// DB audit inside the write transaction; JSONL file audit after commit (web parity).
    public func create(
        input: PerformanceReviewCreateInput,
        auditContext: RegulatedWriteContext
    ) throws -> Int64 {
        let cookName = input.cookName.trimmingCharacters(in: .whitespacesAndNewlines)
        let reviewDate = input.reviewDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let reviewerName = input.reviewerName.trimmingCharacters(in: .whitespacesAndNewlines)
        let cookUuid = input.cookUuid?.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = input.notes?.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !cookName.isEmpty, !reviewDate.isEmpty, !reviewerName.isEmpty else {
            throw PerformanceReviewWriteError.missingRequiredFields
        }

        let scores = PerformanceReviewScores(
            punctualityScore: input.punctualityScore,
            techniqueScore: input.techniqueScore,
            speedScore: input.speedScore
        )
        if let validationError = PerformanceReviewCompute.validateScores(scores) {
            throw PerformanceReviewWriteError.invalidScores(validationError)
        }

        let payload: [String: String] = [
            "cook_name": cookName,
            "cook_uuid": cookUuid ?? "",
            "review_date": reviewDate,
            "punctuality_score": String(input.punctualityScore),
            "technique_score": String(input.techniqueScore),
            "speed_score": String(input.speedScore),
            "reviewer_name": reviewerName,
        ]

        let newId: Int64 = try AuditedWriteRunner.perform(db: database) { db in
            try db.execute(
                sql: """
                  INSERT INTO performance_reviews (
                    cook_name, cook_uuid, review_date,
                    punctuality_score, technique_score, speed_score,
                    notes, reviewer_name, location_id
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    cookName,
                    cookUuid?.isEmpty == true ? nil : cookUuid,
                    reviewDate,
                    input.punctualityScore,
                    input.techniqueScore,
                    input.speedScore,
                    notes?.isEmpty == true ? nil : notes,
                    reviewerName,
                    input.locationId,
                ]
            )
            let id = db.lastInsertedRowID
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "performance_reviews",
                    entityId: id,
                    action: .insert,
                    actorCookId: auditContext.actorCookId,
                    actorSource: auditContext.actorSource,
                    payload: payload,
                    shiftDate: auditContext.shiftDate,
                    locationId: auditContext.locationId
                )
            )
            return id
        }

        do {
            try auditLogger.logPerformanceReviewLogged(
                reviewerName: reviewerName,
                cookName: cookName,
                cookUuid: cookUuid,
                reviewDate: reviewDate,
                locationId: input.locationId
            )
        } catch {
            fputs("performance review file-audit write failed: \(error)\n", stderr)
        }

        return newId
    }
}
