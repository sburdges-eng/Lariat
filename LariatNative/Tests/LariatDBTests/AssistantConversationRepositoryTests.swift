import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// DB-half parity port of tests/js/test-lari-conversation-memory.mjs against
/// the real lari_conversation_turns schema.
final class AssistantConversationRepositoryTests: XCTestCase {
    private let SESSION = "11111111-1111-4111-8111-111111111111"
    private let OTHER_SESSION = "22222222-2222-4222-8222-222222222222"

    private func makeRepo() throws -> (AssistantConversationRepository, LariatWriteDatabase, String) {
        let path = try seedAssistantDatabase()
        let writeDB = try LariatWriteDatabase(path: path)
        return (AssistantConversationRepository(writeDB: writeDB), writeDB, path)
    }

    private func count(_ writeDB: LariatWriteDatabase) throws -> Int {
        try writeDB.pool.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM lari_conversation_turns") ?? -1
        }
    }

    func testLoadsOnlyExactLocationCookSessionRows() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }

        try repo.store(locationId: "loc-a", cookId: "cook-a", sessionId: SESSION,
                       userContent: "show vendor shocks", assistantContent: "Sysco moved up.",
                       managerTier: false, createdAt: "2026-06-03T10:00:00.000Z")
        try repo.store(locationId: "loc-b", cookId: "cook-a", sessionId: SESSION,
                       userContent: "foreign location", assistantContent: "foreign answer",
                       managerTier: false, createdAt: "2026-06-03T10:01:00.000Z")
        try repo.store(locationId: "loc-a", cookId: "cook-b", sessionId: SESSION,
                       userContent: "foreign cook", assistantContent: "foreign answer",
                       managerTier: false, createdAt: "2026-06-03T10:02:00.000Z")
        try repo.store(locationId: "loc-a", cookId: "cook-a", sessionId: OTHER_SESSION,
                       userContent: "foreign session", assistantContent: "foreign answer",
                       managerTier: false, createdAt: "2026-06-03T10:03:00.000Z")

        let turns = try repo.loadRecent(
            locationId: "loc-a", cookId: "cook-a", sessionId: SESSION,
            hasPin: false, now: "2026-06-03T10:04:00.000Z"
        )
        XCTAssertEqual(turns.count, 1)
        XCTAssertEqual(turns.first?.userContent, "show vendor shocks")
    }

    func testKeepsLatestSixInAscendingOrder() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }

        for i in 0..<8 {
            try repo.store(locationId: "default", cookId: "cook-a", sessionId: SESSION,
                           userContent: "u\(i)", assistantContent: "a\(i)",
                           managerTier: false, createdAt: "2026-06-03T10:0\(i):00.000Z")
        }
        let turns = try repo.loadRecent(
            locationId: "default", cookId: "cook-a", sessionId: SESSION,
            hasPin: false, now: "2026-06-03T10:30:00.000Z"
        )
        XCTAssertEqual(turns.map(\.userContent), ["u2", "u3", "u4", "u5", "u6", "u7"])
    }

    func testManagerTierRowsHiddenWithoutPinVisibleWithPin() throws {
        let (repo, _, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }

        try repo.store(locationId: "default", cookId: "cook-a", sessionId: SESSION,
                       userContent: "what did we sell", assistantContent: "Manager-only sales answer",
                       managerTier: true, createdAt: "2026-06-03T10:00:00.000Z")

        XCTAssertEqual(try repo.loadRecent(
            locationId: "default", cookId: "cook-a", sessionId: SESSION,
            hasPin: false, now: "2026-06-03T10:05:00.000Z"
        ).count, 0)
        XCTAssertEqual(try repo.loadRecent(
            locationId: "default", cookId: "cook-a", sessionId: SESSION,
            hasPin: true, now: "2026-06-03T10:05:00.000Z"
        ).count, 1)
    }

    func testLazySweepDeletesExpiredRows() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }

        try repo.store(locationId: "default", cookId: "cook-a", sessionId: SESSION,
                       userContent: "old", assistantContent: "old answer",
                       managerTier: false, createdAt: "2026-06-03T00:00:00.000Z")
        // TTL is 8h — one second past 09:00 sweeps it.
        try repo.sweepExpired(now: "2026-06-03T09:00:01.000Z")
        XCTAssertEqual(try count(writeDB), 0)
    }

    func testStoreSkipsWhenEitherSideClipsEmpty() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }

        try repo.store(locationId: "default", cookId: "cook-a", sessionId: SESSION,
                       userContent: "   ", assistantContent: "answer", managerTier: false)
        try repo.store(locationId: "default", cookId: "cook-a", sessionId: SESSION,
                       userContent: "question", assistantContent: "", managerTier: false)
        XCTAssertEqual(try count(writeDB), 0)
    }

    func testStoreClipsContentTo2000AndStampsSchemaVersionAndTtl() throws {
        let (repo, writeDB, path) = try makeRepo()
        defer { cleanupAssistantDatabase(path) }

        try repo.store(locationId: "default", cookId: "cook-a", sessionId: SESSION,
                       userContent: String(repeating: "u", count: 2500),
                       assistantContent: "a",
                       managerTier: false, createdAt: "2026-06-03T10:00:00.000Z")
        try writeDB.pool.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT * FROM lari_conversation_turns")!
            XCTAssertEqual((row["user_content"] as String).count, 2000)
            XCTAssertEqual(row["schemaVersion"], "lari_conversation_turn_v1")
            XCTAssertEqual(row["expires_at"], "2026-06-03T18:00:00.000Z", "8h TTL")
        }
    }
}
