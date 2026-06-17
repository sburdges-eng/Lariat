import Foundation

/// Appends management-action JSONL lines. Path resolution lives in `LariatDB.DataDirectory`.
public struct ManagementAuditLogger: Sendable {
    private let auditPath: String
    private static let appendQueue = DispatchQueue(label: "lariat.management-audit.append")

    public init(auditPath: String) {
        self.auditPath = auditPath
    }

    public func logPackSizeAcknowledged(
        packSizeChangesId: Int64,
        vendor: String,
        sku: String,
        prevPack: String?,
        newPack: String?,
        note: String?
    ) throws {
        var entry: [String: Any] = [
            "action": "pack_size_change_acknowledged",
            "pack_size_changes_id": packSizeChangesId,
            "vendor": vendor,
            "sku": sku,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "id": "audit_\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(8))",
        ]
        if let prevPack { entry["prev_pack"] = prevPack }
        if let newPack { entry["new_pack"] = newPack }
        if let note { entry["note"] = note }
        let data = try JSONSerialization.data(withJSONObject: entry)
        guard var line = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "ManagementAuditLogger", code: 1)
        }
        line.append("\n")
        try Self.appendQueue.sync {
            try appendLine(line)
        }
    }

    private func appendLine(_ line: String) throws {
        let url = URL(fileURLWithPath: auditPath)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
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
