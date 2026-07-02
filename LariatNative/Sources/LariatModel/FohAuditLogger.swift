import Foundation

/// Appends FOH waitlist JSONL audit lines — parity with the web's
/// `logAuditAction` calls in `/api/host/waitlist` (`lib/auditLog.mjs`
/// file stream: operational data, NOT the regulated `audit_events` DB
/// stream). Mirrors `ManagementAuditLogger`'s append + id conventions;
/// kept separate so this wave does not touch that file.
public struct FohAuditLogger: Sendable {
    private let auditPath: String
    private static let appendQueue = DispatchQueue(label: "lariat.foh-audit.append")

    public init(auditPath: String) {
        self.auditPath = auditPath
    }

    /// Web: `logAuditAction({ action: 'waitlist_add', waitlist_party_id,
    /// location_id, party_name, party_size })`.
    public func logWaitlistAdd(
        waitlistPartyId: Int64,
        locationId: String,
        partyName: String,
        partySize: Int
    ) throws {
        try append(entry: [
            "action": "waitlist_add",
            "waitlist_party_id": waitlistPartyId,
            "location_id": locationId,
            "party_name": partyName,
            "party_size": partySize,
        ])
    }

    /// Web: `logAuditAction({ action: 'waitlist_status_change',
    /// waitlist_party_id, location_id, from, to })`.
    public func logWaitlistStatusChange(
        waitlistPartyId: Int64,
        locationId: String,
        from: String,
        to: String
    ) throws {
        try append(entry: [
            "action": "waitlist_status_change",
            "waitlist_party_id": waitlistPartyId,
            "location_id": locationId,
            "from": from,
            "to": to,
        ])
    }

    /// Adds the standard fields (`timestamp`, generated `id`) the web's
    /// `logAuditAction` injects, then appends one JSONL line.
    private func append(entry: [String: Any]) throws {
        var full = entry
        full["timestamp"] = ISO8601DateFormatter().string(from: Date())
        full["id"] = "audit_\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(8))"
        let data = try JSONSerialization.data(withJSONObject: full)
        guard var line = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "FohAuditLogger", code: 1)
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
