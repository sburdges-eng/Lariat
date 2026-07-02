import SwiftUI
import LariatDB
import LariatModel

/// Inventory LOG board — native port of `app/inventory/log/page.jsx`. Today's
/// inventory movements (newest first) with a manual log-movement form. Reads
/// open; writes audited, no PIN.
struct InventoryLogView: View {
    @State private var vm: InventoryLogViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: InventoryLogViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load log", message: err, systemImage: "shippingbox")
            } else {
                content
            }
        }
        .navigationTitle("Inventory log")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showForm) { form }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            List {
                if let e = vm.actionError { Section { Text(e).font(.callout).foregroundStyle(.red) } }
                Section("Today (\(vm.rows.count))") {
                    if vm.rows.isEmpty {
                        Text("No movements logged today.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.rows) { row in movementRow(row) }
                    }
                }
            }
            HStack {
                Spacer()
                Button("Log movement") { vm.showForm = true }.padding()
            }
        }
    }

    @ViewBuilder
    private func movementRow(_ row: InventoryUpdateRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.item).font(.callout)
                if let note = row.note, !note.isEmpty {
                    Text(note).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                } else if let station = row.stationId, !station.isEmpty {
                    Text(station).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.delta ?? "—").font(.callout.monospacedDigit())
                if let dir = row.direction, !dir.isEmpty {
                    Text(dir).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        NavigationStack {
            Form {
                TextField("Item", text: $vm.item)
                TextField("Qty (optional)", text: $vm.qtyText)
                TextField("Unit (e.g. oz, lb)", text: $vm.unit)
                Picker("Direction", selection: $vm.direction) {
                    ForEach(vm.directions, id: \.self) { Text($0).tag($0) }
                }
                TextField("Note (optional)", text: $vm.note)
                if let e = vm.actionError { Text(e).font(.caption).foregroundStyle(.red) }
            }
            .navigationTitle("Log movement")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { vm.showForm = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { vm.addMovement() }
                        .disabled(vm.item.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 380)
    }
}
