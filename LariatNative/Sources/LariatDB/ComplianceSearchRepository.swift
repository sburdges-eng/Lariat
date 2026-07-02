import Foundation
import GRDB
import LariatModel

/// Read-only BM25 client for the in-tree compliance index — port of
/// `lib/complianceSearch.ts` (lexical half). The index lives at
/// `data/cache/compliance.db`, built by scripts/build-compliance-index.mjs.
/// Missing file / bad DB → graceful no-op (`available() == false`), exactly
/// like the web client on machines without the cache.
///
/// Deferral (Phase B plan): the BGE semantic + hybrid channels are deferred —
/// this repository is the lexical fallback the web itself uses when the
/// vectors sidecar is absent.
public struct ComplianceSearchRepository {
    let queue: DatabaseQueue?

    public init(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        self.init(dbPath: (cacheDir as NSString).appendingPathComponent("compliance.db"))
    }

    public init(dbPath: String?) {
        guard let dbPath, FileManager.default.fileExists(atPath: dbPath) else {
            self.queue = nil
            return
        }
        var config = Configuration()
        config.readonly = true
        do {
            let q = try DatabaseQueue(path: dbPath, configuration: config)
            try q.inDatabase { db in
                try db.execute(sql: "PRAGMA query_only = ON")
            }
            self.queue = q
        } catch {
            self.queue = nil
        }
    }

    public func available() -> Bool { queue != nil }

    /// `searchCompliance(query, opts)` — BM25 over compliance_fts.
    public func search(
        _ query: String, limit: Int = 5, domains: [String] = []
    ) -> [ComplianceSearchCompute.SearchHit] {
        guard let queue else { return [] }
        guard let matchExpr = ComplianceSearchCompute.matchExpression(query) else { return [] }
        let clamped = max(1, min(25, limit))

        var sql = """
            SELECT cr.id, cr.domain, cr.jurisdiction, cr.topic, cr.audience,
                   cr.verification_status, cr.payload, bm25(compliance_fts) AS bm25
              FROM compliance_fts
              JOIN compliance_rules cr ON cr.id = compliance_fts.id
             WHERE compliance_fts MATCH ?
            """
        var arguments: [DatabaseValueConvertible] = [matchExpr]
        if !domains.isEmpty {
            sql += " AND cr.domain IN (\(domains.map { _ in "?" }.joined(separator: ",")))"
            arguments.append(contentsOf: domains)
        }
        sql += " ORDER BY bm25(compliance_fts) ASC LIMIT ?"
        arguments.append(clamped)

        do {
            return try queue.read { db in
                try Row.fetchAll(db, sql: sql, arguments: StatementArguments(arguments)).compactMap { row in
                    guard let payloadJSON = row["payload"] as String?,
                          let rule = try? JSONDecoder().decode(
                              ComplianceSearchCompute.RulePayload.self,
                              from: Data(payloadJSON.utf8)
                          )
                    else { return nil }
                    return ComplianceSearchCompute.SearchHit(
                        id: row["id"],
                        verificationStatus: row["verification_status"] ?? "",
                        rule: rule
                    )
                }
            }
        } catch {
            return []
        }
    }

    /// `renderCompliance(question, opts)` — CONTEXT block (limit 3 by default).
    public func renderCompliance(_ question: String, limit: Int = 3) -> AssistantContextCompute.Section {
        ComplianceSearchCompute.renderCompliance(search(question, limit: limit))
    }
}
