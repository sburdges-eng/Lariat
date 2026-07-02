import Foundation
import GRDB
import LariatModel

/// DB half of `lib/lariConversationMemory.ts` — sweep/store/load over
/// `lari_conversation_turns`. Conversation turns are NOT regulated writes on
/// the web (no audit row) so they run as plain writes; they never mix into an
/// AuditedWriteRunner transaction.
public struct AssistantConversationRepository {
    private let writeDB: LariatWriteDatabase

    public init(writeDB: LariatWriteDatabase) {
        self.writeDB = writeDB
    }

    /// `sweepExpiredConversationTurns(db, now)` — lazy TTL sweep.
    public func sweepExpired(now: String = LariConversationMemoryCompute.isoString()) throws {
        _ = try writeDB.write { db in
            try db.execute(
                sql: "DELETE FROM lari_conversation_turns WHERE expires_at <= ?",
                arguments: [now]
            )
        }
    }

    /// `storeConversationTurn(db, args)` — no-op when either side clips to empty.
    public func store(
        locationId: String,
        cookId: String,
        sessionId: String,
        userContent: String,
        assistantContent: String,
        managerTier: Bool,
        createdAt: String? = nil
    ) throws {
        let created = createdAt ?? LariConversationMemoryCompute.isoString()
        let user = LariConversationMemoryCompute.clipText(
            userContent, LariConversationMemoryCompute.storedTurnContentMaxChars
        )
        let assistant = LariConversationMemoryCompute.clipText(
            assistantContent, LariConversationMemoryCompute.storedTurnContentMaxChars
        )
        if user.isEmpty || assistant.isEmpty { return }

        _ = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO lari_conversation_turns
                    (schemaVersion, location_id, cook_id, conversation_session_id,
                     user_content, assistant_content, manager_tier, created_at, expires_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    LariConversationMemoryCompute.schemaVersion,
                    locationId,
                    cookId,
                    sessionId,
                    user,
                    assistant,
                    managerTier ? 1 : 0,
                    created,
                    LariConversationMemoryCompute.addHoursIso(
                        created, hours: LariConversationMemoryCompute.ttlHours
                    ),
                ]
            )
        }
    }

    /// `loadRecentConversationTurns(db, args)` — exact location + cook + session
    /// scope, unexpired only, manager-tier rows hidden without PIN, latest 6 in
    /// created_at ASC order.
    public func loadRecent(
        locationId: String,
        cookId: String,
        sessionId: String,
        hasPin: Bool,
        now: String = LariConversationMemoryCompute.isoString()
    ) throws -> [StoredConversationTurn] {
        try writeDB.pool.read { db in
            try Row.fetchAll(
                db,
                sql: """
                  SELECT id, user_content, assistant_content, manager_tier, created_at
                    FROM (
                      SELECT id, user_content, assistant_content, manager_tier, created_at
                        FROM lari_conversation_turns
                       WHERE location_id = ?
                         AND cook_id = ?
                         AND conversation_session_id = ?
                         AND expires_at > ?
                         AND (? = 1 OR manager_tier = 0)
                       ORDER BY created_at DESC, id DESC
                       LIMIT ?
                    )
                   ORDER BY created_at ASC, id ASC
                  """,
                arguments: [
                    locationId, cookId, sessionId, now,
                    hasPin ? 1 : 0,
                    LariConversationMemoryCompute.maxTurns,
                ]
            ).map { row in
                StoredConversationTurn(
                    id: row["id"],
                    userContent: row["user_content"],
                    assistantContent: row["assistant_content"],
                    managerTier: row["manager_tier"],
                    createdAt: row["created_at"]
                )
            }
        }
    }
}
