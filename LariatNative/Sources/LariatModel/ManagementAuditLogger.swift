import Foundation

public struct ManagementAuditLogger: Sendable {
    private let auditPath: String

    public init(auditPath: String? = nil, env: [String: String] = ProcessInfo.processInfo.environment, cwd: String = FileManager.default.currentDirectoryPath) {
        if let auditPath { self.auditPath = auditPath }
        else if let override = env["LARIAT_AUDIT_PATH"], !override.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.auditPath = override
        } else {
            let dataDir: String
            if let raw = env["LARIAT_DATA_DIR"], !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                dataDir = (raw as NSString).isAbsolutePath ? raw : (cwd as NSString).appendingPathComponent(raw)
            } else {
                dataDir = (cwd as NSString).appendingPathComponent("data")
            }
            self.auditPath = (dataDir as NSString).appendingPathComponent("audit/management-actions.jsonl")
        }
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
        let url = URL(fileURLWithPath: auditPath)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: auditPath) {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            if let d = line.data(using: .utf8) { try handle.write(contentsOf: d) }
        } else {
            try line.write(to: url, atomically: true, encoding: .utf8)
        }
    }
}
