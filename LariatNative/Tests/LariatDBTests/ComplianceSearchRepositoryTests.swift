import XCTest
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Lexical BM25 parity for `lib/complianceSearch.ts` against a fixture
/// compliance.db with the REAL index schema (compliance_rules +
/// porter-tokenized compliance_fts). The semantic/hybrid channel is deferred
/// (Phase B plan) — BM25 is exactly what the web runs without the vectors
/// sidecar.
final class ComplianceSearchRepositoryTests: XCTestCase {

    private func seedComplianceDb() throws -> String {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-compliance-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("compliance.db").path
        let queue = try DatabaseQueue(path: path)
        try queue.write { db in
            try db.execute(sql: """
                CREATE TABLE compliance_rules (
                  id            TEXT PRIMARY KEY,
                  domain        TEXT NOT NULL,
                  jurisdiction  TEXT NOT NULL,
                  topic         TEXT NOT NULL,
                  audience      TEXT NOT NULL,
                  verification_status TEXT NOT NULL,
                  payload       TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE compliance_fts USING fts5(
                  id UNINDEXED,
                  domain UNINDEXED,
                  title,
                  audience_text,
                  body,
                  tokenize = 'porter ascii'
                );
                """)
            func insert(id: String, domain: String, topic: String, status: String, summary: String, body: String) throws {
                let payload = """
                    {"id":"\(id)","domain":"\(domain)","topic":"\(topic)",
                     "plain_language_summary":"\(summary)",
                     "required_actions":["Check ID","Log refusals","Escalate fakes","Fourth action"],
                     "prohibited_actions":["Serving minors"],
                     "escalation":{"manager_required":true},
                     "source":{"title":"CO Liquor Code"}}
                    """
                try db.execute(
                    sql: "INSERT INTO compliance_rules VALUES (?, ?, 'CO', ?, '[\"manager\"]', ?, ?)",
                    arguments: [id, domain, topic, status, payload]
                )
                try db.execute(
                    sql: "INSERT INTO compliance_fts (id, domain, title, audience_text, body) VALUES (?, ?, ?, 'manager', ?)",
                    arguments: [id, domain, topic, body]
                )
            }
            try insert(
                id: "liquor-001", domain: "liquor_law", topic: "ID checks", status: "verified",
                summary: "Check ID for anyone who looks under 50.",
                body: "Fake ID handling, underage service refusal, identification checks at the door."
            )
            try insert(
                id: "labor-001", domain: "labor_law", topic: "Overtime pay", status: "unverified",
                summary: "Overtime kicks in past 40 hours weekly.",
                body: "Overtime wage rules for hourly restaurant employees in Colorado."
            )
        }
        return path
    }

    func testMissingDbIsGracefulNoOp() {
        let repo = ComplianceSearchRepository(dbPath: "/nonexistent/compliance.db")
        XCTAssertFalse(repo.available())
        XCTAssertEqual(repo.search("fake id"), [])
        XCTAssertEqual(repo.renderCompliance("fake id"), .empty)
    }

    func testSearchFindsRuleByBodyTokens() throws {
        let path = try seedComplianceDb()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ComplianceSearchRepository(dbPath: path)
        XCTAssertTrue(repo.available())

        let hits = repo.search("How do we handle a fake ID?")
        XCTAssertEqual(hits.first?.id, "liquor-001")
        XCTAssertEqual(hits.first?.rule.topic, "ID checks")
    }

    func testDomainFilterRestricts() throws {
        let path = try seedComplianceDb()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ComplianceSearchRepository(dbPath: path)

        let laborOnly = repo.search("overtime rules colorado", domains: ["labor_law"])
        XCTAssertEqual(laborOnly.map(\.id), ["labor-001"])
        let liquorOnly = repo.search("overtime rules colorado", domains: ["liquor_law"])
        XCTAssertEqual(liquorOnly, [])
    }

    func testStopWordOnlyQueryReturnsEmpty() throws {
        let path = try seedComplianceDb()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ComplianceSearchRepository(dbPath: path)
        XCTAssertEqual(repo.search("how do we do this"), [])
    }

    func testRenderComplianceBlockShapeThroughRepository() throws {
        let path = try seedComplianceDb()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ComplianceSearchRepository(dbPath: path)

        let section = repo.renderCompliance("fake id underage")
        XCTAssertTrue(section.text.contains("COLORADO COMPLIANCE (verify before acting):"))
        XCTAssertTrue(section.text.contains("[liquor-001] ID checks (liquor_law)"))
        XCTAssertTrue(section.text.contains("required: Check ID; Log refusals; Escalate fakes"), "capped at 3")
        XCTAssertTrue(section.text.contains("escalation: manager required"))
        XCTAssertTrue(section.text.contains("verification: verified"))
        XCTAssertTrue(section.text.contains("verify with counsel before treating as authoritative"))
        XCTAssertEqual(section.source?.type, "compliance")
    }
}
