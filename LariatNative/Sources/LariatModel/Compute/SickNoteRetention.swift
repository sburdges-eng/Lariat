// LariatNative/Sources/LariatModel/Compute/SickNoteRetention.swift
import Foundation

/// Sick-note document retention policy (audit P0-6, owner-ratified 2026-07-10).
public enum SickNoteRetention {
    public static let windowDays = 730
    public static let retentionCitation =
        "2 years after upload — HFWA-adjacent; matches the sick-worker report window in " +
        "HEALTH_SAFETY_LABOR_AUDIT §5; owner-ratified 2026-07-10."

    /// FAILS OPEN: an unparseable timestamp returns false (not overdue). Opposite polarity
    /// from the auth precedent — a malformed uploaded_at must never mark real PHI for deletion.
    public static func isOverdue(uploadedAt: String, now: Date) -> Bool {
        guard let ts = AuditLogCompute.parseTimestamp(uploadedAt) else { return false }
        return now.timeIntervalSince(ts) / 86_400 >= Double(windowDays)
    }
}
