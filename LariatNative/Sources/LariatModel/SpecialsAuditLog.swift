import Foundation

/// Appends the saved-specials management-action JSONL lines — parity with the
/// web routes' `logAuditAction` calls (`lib/auditLog.mjs`): one line per
/// mutation with `action`, the route's context fields, plus the standard
/// `timestamp` + `id` fields. Path resolution is the caller's job
/// (`LariatDB.resolveManagementAuditPath`).
///
/// Self-contained appender (rather than an extension on
/// `ManagementAuditLogger`) because that type's append path is `private` to
/// its file; the on-disk format is identical.
public struct SpecialsAuditLog: Sendable {
    private let auditPath: String
    private static let appendQueue = DispatchQueue(label: "lariat.specials-audit.append")

    public init(auditPath: String) {
        self.auditPath = auditPath
    }

    /// `specials.create` — `{action, special_id, name, location_id}`.
    public func logCreate(specialId: String, name: String, locationId: String) throws {
        try append(["action": "specials.create", "special_id": specialId,
                    "name": name, "location_id": locationId])
    }

    /// `specials.update` — `{action, special_id, changed, location_id}`.
    public func logUpdate(specialId: String, changed: [String], locationId: String) throws {
        try append(["action": "specials.update", "special_id": specialId,
                    "changed": changed, "location_id": locationId])
    }

    /// `specials.delete` — `{action, special_id, location_id}`.
    public func logDelete(specialId: String, locationId: String) throws {
        try append(["action": "specials.delete", "special_id": specialId,
                    "location_id": locationId])
    }

    /// `specials.export` — `{action, special_id, slug, location_id}`.
    public func logExport(specialId: String, slug: String, locationId: String) throws {
        try append(["action": "specials.export", "special_id": specialId,
                    "slug": slug, "location_id": locationId])
    }

    /// `specials.promote` — `{action, special_id, menu_item_name, location_id}`.
    public func logPromote(specialId: String, menuItemName: String, locationId: String) throws {
        try append(["action": "specials.promote", "special_id": specialId,
                    "menu_item_name": menuItemName, "location_id": locationId])
    }

    private func append(_ fields: [String: Any]) throws {
        var entry = fields
        entry["timestamp"] = ISO8601DateFormatter().string(from: Date())
        entry["id"] = "audit_\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(8))"
        let data = try JSONSerialization.data(withJSONObject: entry)
        guard var line = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "SpecialsAuditLog", code: 1)
        }
        line.append("\n")
        try Self.appendQueue.sync {
            try appendLine(line)
        }
    }

    private func appendLine(_ line: String) throws {
        let url = URL(fileURLWithPath: auditPath)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
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
