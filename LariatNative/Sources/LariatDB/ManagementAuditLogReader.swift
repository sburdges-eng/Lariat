import Foundation
import LariatModel

/// Read side of the management-actions JSONL — parity with `lib/auditLog.mjs`
/// (`getRecentAuditLog`, `getAuditLogByAction`, `getAuditLogForRecipe`,
/// `exportAuditLog`). Buffered whole-file read (same as the web module);
/// a missing or unreadable file yields `[]`, never a throw — the audit board
/// must degrade, not crash.
///
/// The default path comes from `resolveManagementAuditPath` (honors the
/// `LARIAT_AUDIT_PATH` override, else `<dataDir>/audit/management-actions.jsonl`
/// — the exact same resolution the web module performs at call time).
public struct ManagementAuditLogReader: Sendable {
    private let auditPath: String

    public init(auditPath: String = resolveManagementAuditPath()) {
        self.auditPath = auditPath
    }

    /// `getRecentAuditLog(limit = 100)`.
    public func recent(limit: Int = 100) -> [ManagementAuditEntry] {
        guard let content = readContent() else { return [] }
        return AuditLogCompute.recent(content: content, limit: limit)
    }

    /// `getAuditLogByAction(action)` — full scan, no legacy cap.
    public func byAction(_ action: String) -> [ManagementAuditEntry] {
        guard let content = readContent() else { return [] }
        return AuditLogCompute.byAction(content: content, action: action)
    }

    /// `getAuditLogForRecipe(slug)` — full scan, no legacy cap.
    public func forSlug(_ slug: String) -> [ManagementAuditEntry] {
        guard let content = readContent() else { return [] }
        return AuditLogCompute.forSlug(content: content, slug: slug)
    }

    /// `exportAuditLog(startDate, endDate)` — inclusive window, full scan.
    public func export(start: Date, end: Date) -> [ManagementAuditEntry] {
        guard let content = readContent() else { return [] }
        return AuditLogCompute.export(content: content, start: start, end: end)
    }

    private func readContent() -> String? {
        guard FileManager.default.fileExists(atPath: auditPath) else { return nil }
        guard let data = FileManager.default.contents(atPath: auditPath) else { return nil }
        // Lossy decode (invalid bytes → U+FFFD) mirrors Node readFileSync('utf-8'):
        // a torn multi-byte write corrupts only its own line (JSON parse skips it),
        // never the whole file — strict decoding would blank the entire board.
        return String(decoding: data, as: UTF8.self)
    }
}
