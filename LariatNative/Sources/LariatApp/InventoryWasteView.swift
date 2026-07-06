import SwiftUI
import LariatDB
import LariatModel

/// Inventory WASTE board — native port of `app/inventory/waste/page.jsx`. A
/// most-wasted-by-item rollup + recent waste rows over a 1/7/30-day window, with
/// a log-waste form. Reads open; writes audited, no PIN.
struct InventoryWasteView: View {
    @State private var vm: InventoryWasteViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: InventoryWasteViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.recent.isEmpty, vm.byItem.isEmpty {
                TileDegrade(title: "Could not load waste", message: err, systemImage: "trash")
            } else {
                content
            }
        }
        .navigationTitle("Waste")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showForm) { form }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            List {
                Section {
                    Picker("Range", selection: $vm.days) {
                        ForEach(vm.ranges, id: \.self) { d in
                            Text(d == 1 ? "Today" : "\(d) days").tag(d)
                        }
                    }
                    .pickerStyle(.segmented)
                    if let e = vm.actionError { Text(e).font(.callout).foregroundStyle(.red) }
                }

                Section("Most wasted") {
                    if vm.byItem.isEmpty {
                        Text("No waste logged in this range.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.byItem) { b in
                            HStack {
                                Text(b.item).font(.callout)
                                Spacer()
                                Text("\(b.hits)×").font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }

                Section("Recent (\(vm.recent.count))") {
                    if vm.recent.isEmpty {
                        Text("Nothing here.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.recent) { row in recentRow(row) }
                    }
                }
            }
            HStack {
                Spacer()
                Button("Log waste") { vm.showForm = true }.padding()
            }
        }
    }

    @ViewBuilder
    private func recentRow(_ row: InventoryUpdateRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.item).font(.callout)
                Text(recentMeta(row)).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            Text(row.delta ?? "—").font(.callout.monospacedDigit())
        }
        .accessibilityElement(children: .combine)
    }

    private func recentMeta(_ row: InventoryUpdateRow) -> String {
        var parts = [row.shiftDate]
        if let note = row.note, !note.isEmpty { parts.append(note) }
        else if let station = row.stationId, !station.isEmpty { parts.append(station) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var form: some View {
        NavigationStack {
            Form {
                TextField("Item", text: $vm.item)
                TextField("Station (optional)", text: $vm.stationId)
                TextField("Qty (optional)", text: $vm.qtyText)
                TextField("Unit (e.g. oz, lb)", text: $vm.unit)
                TextField("Why (reason)", text: $vm.reason)
                if let e = vm.actionError { Text(e).font(.caption).foregroundStyle(.red) }
            }
            .navigationTitle("Log waste")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { vm.showForm = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { vm.logWaste() }
                        .disabled(vm.item.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 380)
    }
}
