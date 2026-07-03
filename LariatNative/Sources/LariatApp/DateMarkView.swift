import SwiftUI
import LariatDB
import LariatModel

struct DateMarkView: View {
    @State private var vm: DateMarkViewModel
    @State private var item = ""
    @State private var preparedOn = ShiftDate.todayISO()
    @State private var batchRef = ""
    @State private var discardTarget: DateMarkRow?
    @State private var query = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: DateMarkViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load date marks", message: err, systemImage: "calendar.badge.exclamationmark")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView("Loading date marks…")
            }
        }
        .navigationTitle("Date marks")
        .onAppear { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable
            ) { vm.showCookPicker = false }
        }
        .confirmationDialog("Discard batch", isPresented: Binding(
            get: { discardTarget != nil },
            set: { if !$0 { discardTarget = nil } }
        ), titleVisibility: .visible) {
            // Confirmation dialogs render Buttons only (a Picker is silently
            // dropped), so offer one destructive button per discard reason —
            // same pattern as TphcView's per-reason discard buttons.
            ForEach(DateMarkDiscardReason.allCases) { reason in
                Button(reason.label, role: .destructive) {
                    if let row = discardTarget {
                        Task { await vm.discard(id: row.id, reason: reason) }
                    }
                    discardTarget = nil
                }
            }
            Button("Cancel", role: .cancel) { discardTarget = nil }
        } message: {
            Text("Why is this batch being discarded? The reason goes on the compliance record.")
        }
    }

    @ViewBuilder
    private func content(_ snap: DateMarkBoardSnapshot) -> some View {
        List {
            Section("Active batches") {
                if snap.active.isEmpty {
                    EmptyState(message: "No active date marks", systemImage: "calendar.badge.checkmark")
                } else if filteredActive.isEmpty {
                    EmptyState(message: "No batches match “\(query)”", systemImage: "magnifyingglass")
                } else {
                    ForEach(filteredActive) { row in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.item).font(.headline)
                                Text("Discard by \(row.discardOn)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            statusBadge(vm.status(for: row))
                            Button("Discard") { discardTarget = row }
                                .font(.caption)
                        }
                    }
                }
            }

            Section("New mark") {
                TextField("Item", text: $item)
                TextField("Prepared on (YYYY-MM-DD)", text: $preparedOn)
                TextField("Batch ref (optional)", text: $batchRef)
                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button(vm.isSaving ? "Saving…" : "Save mark") {
                    Task { await vm.create(item: item, preparedOn: preparedOn, batchRef: batchRef) }
                }
                .disabled(vm.isSaving || item.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .searchable(text: $query, prompt: "Find a batch")
    }

    private var filteredActive: [DateMarkRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return vm.snapshot?.active ?? [] }
        return (vm.snapshot?.active ?? []).filter { $0.item.localizedCaseInsensitiveContains(q) }
    }

    @ViewBuilder
    private func statusBadge(_ status: ExpiringBatchStatus?) -> some View {
        switch status {
        case .expired:
            Text("Expired").font(.caption2).padding(4).background(LariatTheme.bad.opacity(0.2)).clipShape(Capsule())
        case .dueToday:
            Text("Due today").font(.caption2).padding(4).background(LariatTheme.warn.opacity(0.3)).clipShape(Capsule())
        case .ok, .none:
            EmptyView()
        }
    }
}
