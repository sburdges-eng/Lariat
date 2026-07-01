import SwiftUI
import LariatDB
import LariatModel

/// Cook-tier standing prep par screen — native port of `app/prep/par`.
/// Lists recurring prep targets grouped by station (empty → "General"), with an
/// add/upsert form and a two-step confirm delete, matching the web components.
struct PrepParView: View {
    @State private var vm: PrepParViewModel
    @State private var showAdd = false
    @State private var recipe = ""
    @State private var ingredient = ""
    @State private var station = ""
    @State private var targetQty = ""
    @State private var unit = ""
    @State private var note = ""
    @State private var deleteTarget: PrepParRow?

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: PrepParViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(
                    title: "Could not load prep par",
                    message: err,
                    systemImage: "list.bullet.rectangle"
                )
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Standing prep par")
        .onAppear { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable
            ) { vm.showCookPicker = false }
        }
        .confirmationDialog(
            "Remove \(deleteTarget?.label ?? "")?",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let row = deleteTarget {
                    Task { await vm.delete(id: row.id) }
                }
                deleteTarget = nil
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        }
    }

    @ViewBuilder
    private func content(_ snap: PrepParBoardSnapshot) -> some View {
        List {
            Section {
                Text("Recurring prep targets by station — separate from the daily task queue.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            addSection

            if snap.rows.isEmpty {
                Section {
                    Text("No standing prep targets yet. Add one above.")
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(snap.groups) { group in
                    Section(group.title) {
                        ForEach(group.rows) { row in
                            rowView(row)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var addSection: some View {
        Section("Add prep par target") {
            if showAdd {
                TextField("Recipe (e.g. Beer Batter)", text: $recipe)
                TextField("Ingredient (e.g. TOMATO, ROMA)", text: $ingredient)
                TextField("Station (Sauté, Grill…)", text: $station)
                HStack {
                    TextField("Target qty", text: $targetQty)
                        #if os(iOS)
                        .keyboardType(.decimalPad)
                        #endif
                    TextField("Unit (lb, qt, ea)", text: $unit)
                }
                TextField("Note", text: $note)

                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Text("Fill Recipe or Ingredient — not both.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                HStack {
                    Button(vm.isSaving ? "Saving…" : "Save") {
                        Task {
                            await vm.save(
                                recipe: recipe, ingredient: ingredient, station: station,
                                targetQty: targetQty, unit: unit, note: note
                            )
                            if vm.actionError == nil { resetForm() }
                        }
                    }
                    .disabled(vm.isSaving || bothEmpty)
                    Button("Cancel", role: .cancel) { resetForm(); showAdd = false }
                        .disabled(vm.isSaving)
                }
            } else {
                Button("+ Add prep par target") { showAdd = true }
            }
        }
    }

    @ViewBuilder
    private func rowView(_ row: PrepParRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.label).font(.headline)
                Text(metaLine(row))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Remove") { deleteTarget = row }
                .font(.caption)
        }
    }

    private var bothEmpty: Bool {
        recipe.trimmingCharacters(in: .whitespaces).isEmpty
            && ingredient.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// "target 12 portions · note · updated Apr 26" — mirrors page.jsx meta line.
    private func metaLine(_ row: PrepParRow) -> String {
        var parts: [String] = []
        let qty = row.targetQty.map { formatQty($0) } ?? "—"
        let unit = row.unit ?? ""
        parts.append("target \(qty)\(unit.isEmpty ? "" : " \(unit)")")
        if let note = row.note, !note.isEmpty { parts.append(note) }
        if let updated = row.updatedAt, !updated.isEmpty { parts.append("updated \(updated)") }
        return parts.joined(separator: " · ")
    }

    private func formatQty(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }

    private func resetForm() {
        recipe = ""; ingredient = ""; station = ""; targetQty = ""; unit = ""; note = ""
    }
}
