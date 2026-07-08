import SwiftUI
import LariatDB
import LariatModel

/// Saved-specials management — parity with `/specials/saved` (list) and
/// `/specials/saved/[id]` (detail: rename/notes, delete, promote to menu,
/// CSV export). The sandbox/LLM-generation side of `/specials` is Phase B
/// (kitchen assistant) and is intentionally absent here.
struct SpecialsView: View {
    @State private var vm: SpecialsViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: SpecialsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            switch vm.gate {
            case .locked, .unavailable:
                ReadGateLockedView(title: "Specials", state: vm.gate) { vm.requestUnlock() }
            case .open:
                if let err = vm.fetchError, !vm.loaded {
                    TileDegrade(title: "Could not load saved specials", message: err, systemImage: "fork.knife")
                } else if vm.loaded {
                    content
                } else {
                    ProgressView("Loading saved specials…")
                }
            }
        }
        .navigationTitle("Specials")
        .task { await vm.refresh() }
        .searchable(text: $vm.filter, prompt: "Find a special")
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinStore.save(user: user)
                vm.pinAccepted()
            }
        }
    }

    private var content: some View {
        List {
            if let err = vm.errorMessage {
                Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
            }

            Section("Saved specials (\(vm.filteredItems.count))") {
                if vm.filteredItems.isEmpty {
                    EmptyState(message: vm.items.isEmpty
                        ? "No saved specials yet — save one from the web Specials board."
                        : "No matches for that filter.")
                } else {
                    ForEach(vm.filteredItems) { item in
                        Button {
                            Task { await vm.select(id: item.id) }
                        } label: {
                            listRow(item)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if vm.detail != nil {
                detailSections
            }
        }
    }

    @ViewBuilder
    private func listRow(_ item: SpecialListItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(item.name).font(.headline)
                Spacer()
                if item.lastExportedAt != nil {
                    Text("Exported").font(.caption2).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 8) {
                Text(fmtDate(item.createdAt))
                if let total = item.costTotal {
                    Text(formatDollars(total, decimals: 2))
                }
                if let promoted = item.promotedMenuItem {
                    Text("On menu as “\(promoted)”").foregroundStyle(LariatTheme.ok)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if !item.snippet.isEmpty {
                Text(item.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
    }

    @ViewBuilder
    private var detailSections: some View {
        if let special = vm.detail {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(special.name).font(.title3).bold()
                    Text("Created \(fmtDateTime(special.createdAt))"
                         + (special.lastExportedAt.map { " · Last exported \(fmtDateTime($0))" } ?? ""))
                        .font(.caption).foregroundStyle(.secondary)
                    if !special.pantryText.isEmpty {
                        labeled("Pantry", special.pantryText)
                    }
                    if !special.promptText.isEmpty {
                        labeled("Prompt", special.promptText)
                    }
                    labeled("AI answer", special.aiAnswer)
                    if !special.aiModel.isEmpty {
                        Text("Model: \(special.aiModel)").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Button("Close detail") { vm.closeDetail() }
            } header: {
                Text("Session")
            }

            let breakdown = vm.cachedCostBreakdown
            if !breakdown.isEmpty {
                Section("Cost breakdown" + (special.costTotal.map { " · \(formatDollars($0, decimals: 2))" } ?? "")) {
                    ForEach(Array(breakdown.enumerated()), id: \.offset) { _, line in
                        HStack {
                            Text(line.item ?? "")
                            Spacer()
                            Text("\(line.reqQtyString ?? "?") \(line.reqUnit ?? "")")
                                .foregroundStyle(.secondary)
                            if let match = line.match, !match.isEmpty {
                                Text(match).foregroundStyle(.secondary)
                            } else {
                                Text("unmatched").italic().foregroundStyle(LariatTheme.warn)
                            }
                            if let cost = line.cost {
                                Text(formatDollars(cost, decimals: 2)).monospacedDigit()
                            }
                        }
                        .font(.caption)
                    }
                }
            }

            Section("Edit") {
                TextField("Name", text: $vm.editName)
                TextField("Notes", text: $vm.editNotes, axis: .vertical)
                    .lineLimit(3...10)
                HStack {
                    Button(vm.isSaving ? "Saving…" : "Save changes") { vm.saveMeta() }
                        .disabled(vm.isSaving || vm.editName.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Delete", role: .destructive) { vm.deleteSelected() }
                        .disabled(vm.isSaving)
                }
            }

            Section("Promote to menu") {
                Text("Puts this special on the menu-engineering cost surface: its matched ingredients become per-serving dish components, so margin shows up automatically once it sells.")
                    .font(.caption).foregroundStyle(.secondary)
                if let promo = vm.promotion {
                    Text("On menu as “\(promo.menuItemName)” · Promoted \(fmtDateTime(promo.promotedAt))"
                         + (promo.updatedAt != promo.promotedAt ? " · Refreshed \(fmtDateTime(promo.updatedAt))" : ""))
                        .font(.caption)
                }
                TextField("Menu item name", text: $vm.promoteName)
                TextField("Servings the cost breakdown makes", text: $vm.promoteServings)
                if let err = vm.promoteError {
                    Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
                }
                if !vm.promoteSkipped.isEmpty {
                    Text("\(vm.promoteSkipped.count) ingredient(s) skipped (no vendor match) — their cost won't flow to menu engineering.")
                        .font(.caption).foregroundStyle(LariatTheme.warn)
                }
                Button(vm.promotion == nil ? "Promote" : "Re-promote") { vm.submitPromote() }
                    .disabled(vm.isSaving
                              || vm.promoteName.trimmingCharacters(in: .whitespaces).isEmpty
                              || !((Double(vm.promoteServings) ?? 0) > 0))
            }

            Section("Export to recipe (CSV)") {
                Text("Builds a CSV you can paste straight into the recipe workbook. Doesn't touch the recipe book here — paste it in next time the book gets updated.")
                    .font(.caption).foregroundStyle(.secondary)
                TextField("Slug", text: $vm.exportSlug)
                    .autocorrectionDisabled()
                TextField("Yield qty", text: $vm.exportYieldQty)
                TextField("Yield unit", text: $vm.exportYieldUnit)
                TextField("Category (optional)", text: $vm.exportCategory)
                TextField("Procedure override (optional)", text: $vm.exportProcedure, axis: .vertical)
                    .lineLimit(2...6)
                if let err = vm.exportError {
                    Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
                }
                Button("Generate CSV") { vm.submitExport() }
                    .disabled(vm.isSaving
                              || vm.exportSlug.trimmingCharacters(in: .whitespaces).isEmpty
                              || vm.exportYieldQty.isEmpty)
                if let result = vm.exportResult {
                    if !result.skipped.isEmpty {
                        Text("\(result.skipped.count) unmatched ingredient(s) — pick a vendor item before pasting.")
                            .font(.caption).foregroundStyle(LariatTheme.warn)
                    }
                    ShareLink(
                        item: result.csv,
                        preview: SharePreview("\(vm.exportSlug).csv")
                    ) {
                        Label("Share CSV", systemImage: "square.and.arrow.up")
                    }
                    Text(result.csv)
                        .font(.system(.caption2, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
        }
    }

    @ViewBuilder
    private func labeled(_ label: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(text).font(.caption).textSelection(.enabled)
        }
    }

    private func fmtDate(_ ms: Int64) -> String {
        Date(timeIntervalSince1970: Double(ms) / 1000)
            .formatted(date: .abbreviated, time: .omitted)
    }

    private func fmtDateTime(_ ms: Int64) -> String {
        Date(timeIntervalSince1970: Double(ms) / 1000)
            .formatted(date: .abbreviated, time: .shortened)
    }
}
