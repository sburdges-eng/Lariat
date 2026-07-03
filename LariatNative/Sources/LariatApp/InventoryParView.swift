import SwiftUI
import LariatDB
import LariatModel

/// Inventory PAR board — native port of `app/inventory/par/page.jsx`. Standing
/// par levels per ingredient, grouped by category, each showing the latest
/// counted on-hand with a "below par" flag. Reads open; add/remove are audited
/// (no PIN — /inventory is unregulated).
struct InventoryParView: View {
    @State private var vm: InventoryParViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: InventoryParViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load par", message: err, systemImage: "shippingbox")
            } else {
                content
            }
        }
        .navigationTitle("Par")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showForm) { addForm }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            List {
                Section {
                    Toggle("Below par only (\(vm.lowCount))", isOn: $vm.showLowOnly)
                    if let e = vm.actionError { Text(e).font(.callout).foregroundStyle(.red) }
                }
                ForEach(vm.grouped, id: \.category) { group in
                    Section(group.category) {
                        if group.rows.isEmpty {
                            Text("Nothing here.").foregroundStyle(.secondary)
                        } else {
                            ForEach(group.rows) { row in
                                parRow(row)
                            }
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Button("Add par item") { vm.showForm = true }.padding()
            }
        }
    }

    @ViewBuilder
    private func parRow(_ row: InventoryParWithOnHand) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.par.ingredient).font(.callout)
                Text(metaLine(row)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            if row.isLow {
                Text("below par")
                    .font(.caption2).padding(4)
                    .background(Color.red.opacity(0.18)).clipShape(Capsule())
                    .foregroundStyle(.red)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { vm.remove(row.par.id) } label: { Label("Remove", systemImage: "trash") }
        }
        // Mouse-reachable delete: on macOS swipe actions need a trackpad swipe,
        // so right-click must offer the same Remove.
        .contextMenu {
            Button(role: .destructive) { vm.remove(row.par.id) } label: { Label("Remove", systemImage: "trash") }
        }
    }

    private func metaLine(_ row: InventoryParWithOnHand) -> String {
        var parts: [String] = []
        if let par = row.par.parQty { parts.append("par \(qty(par))\(unit(row.par.parUnit))") }
        if let oh = row.onHandQty { parts.append("on hand \(qty(oh))\(unit(row.onHandUnit))") }
        else { parts.append("not counted") }
        if let v = row.par.vendor, !v.isEmpty { parts.append(v) }
        return parts.joined(separator: " · ")
    }

    private func qty(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }
    private func unit(_ u: String?) -> String { (u?.isEmpty == false) ? " \(u!)" : "" }

    // ── Add-par form ─────────────────────────────────────────────────────

    @ViewBuilder
    private var addForm: some View {
        NavigationStack {
            Form {
                TextField("Ingredient", text: $vm.ingredient)
                TextField("SKU (optional)", text: $vm.sku)
                TextField("Vendor (optional)", text: $vm.vendor)
                TextField("Par qty", text: $vm.parQtyText)
                TextField("Par unit (e.g. lb, ea)", text: $vm.parUnit)
                TextField("Category", text: $vm.category)
                TextField("Note (optional)", text: $vm.note)
                if let e = vm.actionError { Text(e).font(.caption).foregroundStyle(.red) }
            }
            .navigationTitle("Add par item")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { vm.showForm = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { vm.addPar() }
                        .disabled(vm.ingredient.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
    }
}
