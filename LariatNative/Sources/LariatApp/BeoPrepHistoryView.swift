import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Backs `beo.prepHistory` — read-only reference over `beo_prep_history`
/// (`GET /api/beo/prep-history` + lib/beoPrepHistory.ts). Recent catering
/// events plus an item search: exact-item history first, then related rows
/// via the bidirectional recipe-name match.
@Observable @MainActor
final class BeoPrepHistoryViewModel {
    private(set) var recent: [BeoRecentEvent] = []
    private(set) var matches: [BeoPrepHistoryMatch] = []
    private(set) var related: [BeoRecipePrepHistoryRow] = []
    private(set) var loaded = false
    private(set) var searching = false
    var fetchError: String?
    var query = ""

    private let repo: BeoPrepHistoryRepository
    private let locationId: String

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.repo = BeoPrepHistoryRepository(database: database)
        self.locationId = locationId
    }

    func refresh() async {
        do {
            recent = try await repo.recentEvents(limit: 10, locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load prep history."
        }
        loaded = true
    }

    func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            matches = []
            related = []
            return
        }
        searching = true
        defer { searching = false }
        matches = (try? await repo.itemPrepHistory(items: [q], locationId: locationId)) ?? []
        related = (try? await repo.recipePrepHistory(recipeName: q, limit: 10, locationId: locationId)) ?? []
    }
}

/// Native port of the past-prep reference (web PrepHistoryPanel, promoted to
/// its own board): "what did we make for the last birria event, and how much".
struct BeoPrepHistoryView: View {
    @State private var vm: BeoPrepHistoryViewModel

    init(database: LariatDatabase) {
        _vm = State(wrappedValue: BeoPrepHistoryViewModel(database: database))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError {
                TileDegrade(title: "Could not load prep history", message: err, systemImage: "clock.arrow.circlepath")
            } else if !vm.loaded {
                ProgressView("Loading prep history…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Past prep")
        .task { await vm.refresh() }
        .searchable(text: $vm.query, prompt: "Find an item (e.g. Mac Balls)")
        .onSubmit(of: .search) { Task { await vm.search() } }
        .onChange(of: vm.query) { _, newValue in
            if newValue.isEmpty { Task { await vm.search() } }
        }
    }

    private var content: some View {
        List {
            if vm.searching {
                ProgressView("Searching past prep…")
            }

            if !vm.query.isEmpty {
                Section("Exact matches") {
                    if vm.matches.isEmpty {
                        EmptyState(message: "No prior prep on file for that item.", systemImage: "clock.arrow.circlepath")
                    }
                    ForEach(vm.matches) { match in
                        ForEach(Array(match.history.enumerated()), id: \.offset) { _, row in
                            historyRow(item: match.item, row: row)
                        }
                    }
                }
                Section("Related items") {
                    if vm.related.isEmpty {
                        EmptyState(message: "No related BEO rows.", systemImage: "magnifyingglass")
                    }
                    ForEach(Array(vm.related.enumerated()), id: \.offset) { _, row in
                        historyRow(
                            item: row.item,
                            row: BeoPrepHistoryRow(
                                eventDate: row.eventDate, client: row.client, type: row.type,
                                amountQty: row.amountQty, prepDay: row.prepDay,
                                prePrepNotes: row.prePrepNotes, platingNotes: row.platingNotes,
                                source: row.source, importedAt: row.importedAt
                            )
                        )
                    }
                }
            }

            Section("Recent catering events") {
                if vm.recent.isEmpty {
                    EmptyState(message: "No prep history imported yet.", systemImage: "tray")
                }
                ForEach(Array(vm.recent.enumerated()), id: \.offset) { _, event in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(event.eventDate).fontWeight(.medium).monospacedDigit()
                            Text(event.client ?? "unknown client").foregroundStyle(.secondary)
                        }
                        ForEach(Array(event.items.enumerated()), id: \.offset) { _, item in
                            HStack(spacing: 6) {
                                Text(item.item)
                                if let qty = item.amountQty {
                                    Text("× \(qty)").foregroundStyle(.secondary)
                                }
                            }
                            .font(.callout)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func historyRow(item: String, row: BeoPrepHistoryRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(item).fontWeight(.medium)
                Spacer()
                Text(row.eventDate ?? "undated").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Text(row.client ?? "unknown client")
                if let qty = row.amountQty { Text("× \(qty)") }
                if let type = row.type { Text(type).foregroundStyle(.tertiary) }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let prepDay = row.prepDay {
                Text("Prep day: \(prepDay)").font(.caption2).foregroundStyle(.secondary)
            }
            if let pre = row.prePrepNotes {
                Text("Pre-prep: \(pre)").font(.caption2).foregroundStyle(.secondary)
            }
            if let plating = row.platingNotes {
                Text("Plating: \(plating)").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
