import Foundation

/// File-stream audit for OPERATIONAL shows writes (capacity override, stage
/// setup, sound scenes, SPL readings) — parity with `logAuditAction` in
/// `lib/auditLog.mjs`: appends one JSONL line with the caller's fields plus
/// `timestamp` + a generated `id`. Regulated cash-custody writes (box-office
/// lines, show deals) do NOT use this — they post to the `audit_events` DB
/// stream inside the same transaction (`AuditEventWriter`).
///
/// Call `log` INSIDE the GRDB write block, after the source mutation: a
/// throw here rolls the DB mutation back (same posture as the web's
/// `logAuditAction` inside `db.transaction`).
public struct ShowsAuditLogger: Sendable {
    private let auditPath: String
    private static let appendQueue = DispatchQueue(label: "lariat.shows-audit.append")

    public init(auditPath: String = resolveManagementAuditPath()) {
        self.auditPath = auditPath
    }

    /// Append one management-action line. `fields` must be JSON-encodable
    /// scalars/containers; `action` mirrors the web entry's `action` key.
    public func log(action: String, fields: [String: Any?]) throws {
        var entry: [String: Any] = [:]
        for (k, v) in fields {
            entry[k] = v ?? NSNull()   // web JSON.stringify keeps explicit nulls
        }
        entry["action"] = action
        entry["timestamp"] = ISO8601DateFormatter().string(from: Date())
        entry["id"] = "audit_\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(8))"
        let data = try JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys])
        guard var line = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "ShowsAuditLogger", code: 1)
        }
        line.append("\n")
        try Self.appendQueue.sync {
            try appendLine(line)
        }
    }

    private func appendLine(_ line: String) throws {
        let url = URL(fileURLWithPath: auditPath)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        guard let data = line.data(using: .utf8) else { return }
        if FileManager.default.fileExists(atPath: auditPath) {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } else {
            try data.write(to: url, options: .atomic)
        }
    }
}
