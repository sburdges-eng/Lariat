import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `manager.auditLog` — parity with `app/management/audit-log/page.jsx`
/// + `GET /api/audit/log`. STRICTLY read-only: this type imports no write
/// repositories and performs no DB or file writes.
///
/// Filter semantics mirror the web route: an action filter runs the full-scan
/// `byAction`, else a slug filter runs `forSlug`, else `recent(limit)` — then
/// the result is sliced to `limit` (route line 52's `.slice(0, limit)`).
@Observable @MainActor
final class AuditLogViewModel {
    private(set) var logs: [ManagementAuditEntry] = []
    var filterAction: String = ""
    var filterSlug: String = ""
    var searchText: String = ""
    var expandedId: String?
    private(set) var loaded = false

    /// Route default `limit=100`.
    let limit = 100

    private let reader: ManagementAuditLogReader

    init(reader: ManagementAuditLogReader = ManagementAuditLogReader()) {
        self.reader = reader
    }

    func refresh() {
        let action = filterAction
        let slug = filterSlug
        let result: [ManagementAuditEntry]
        if !action.isEmpty {
            result = reader.byAction(action)
        } else if !slug.isEmpty {
            result = reader.forSlug(slug)
        } else {
            result = reader.recent(limit: limit)
        }
        logs = Array(result.prefix(limit))

        // Picker options come from the UNFILTERED recent window — deriving them
        // from the filtered `logs` collapsed each picker to its own selection,
        // forcing a round trip through "All" to switch filters.
        let window = (action.isEmpty && slug.isEmpty)
            ? logs
            : Array(reader.recent(limit: limit).prefix(limit))
        var actions = Set(window.compactMap(\.action))
        var slugs = Set(window.compactMap(\.slug))
        // Keep the active selections listed even if a full-scan filter matched
        // entries older than the recent window, so the Picker selection holds.
        if !action.isEmpty { actions.insert(action) }
        if !slug.isEmpty { slugs.insert(slug) }
        uniqueActions = actions.sorted()
        uniqueSlugs = slugs.sorted()
        loaded = true
    }

    /// Filter-picker sources — distinct values cached from the unfiltered
    /// recent window on each refresh (see `refresh()`).
    private(set) var uniqueActions: [String] = []
    private(set) var uniqueSlugs: [String] = []

    /// Native addition: free-text narrowing across action/slug/user/raw line.
    var visibleLogs: [ManagementAuditEntry] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return logs }
        return logs.filter { entry in
            (entry.action?.lowercased().contains(q) ?? false)
                || (entry.slug?.lowercased().contains(q) ?? false)
                || (entry.user?.lowercased().contains(q) ?? false)
                || entry.raw.lowercased().contains(q)
        }
    }

    func toggleExpanded(_ id: String) {
        expandedId = expandedId == id ? nil : id
    }

    /// Timestamp render — `new Date(log.timestamp).toLocaleString()` analog.
    func displayTimestamp(_ entry: ManagementAuditEntry) -> String {
        guard let raw = entry.timestamp else { return "—" }
        guard let date = AuditLogCompute.parseTimestamp(raw) else { return raw }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
