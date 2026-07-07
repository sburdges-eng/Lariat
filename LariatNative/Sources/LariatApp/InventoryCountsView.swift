import SwiftUI
import LariatDB
import LariatModel

/// Inventory COUNTS board — native port of the `/inventory/counts` web surface.
/// Recent counts (open-only filter + line tally); open a new count; drill into a
/// count to add lines and close/reopen it. Reads open; writes audited, no PIN
/// (/inventory is unregulated). Ingredient names are canonicalized on save so
/// cross-cook capitalization dedups onto one row.
struct InventoryCountsView: View {
    @State private var vm: InventoryCountsViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: InventoryCountsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.counts.isEmpty {
                TileDegrade(title: "Could not load counts", message: err, systemImage: "list.clipboard")
            } else {
                content
            }
        }
        .navigationTitle("Counts")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showNewCount) { newCountForm }
        .sheet(isPresented: $vm.showDetail) { detailSheet }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            List {
                Section {
                    Toggle("Open counts only", isOn: $vm.openOnly)
                    if let e = vm.actionError { Text(e).font(.callout).foregroundStyle(.red) }
                }
                Section("Counts") {
                    if vm.counts.isEmpty {
                        Text("No counts yet.").foregroundStyle(.secondary)
                    } else {
                        ForEach(vm.counts) { c in
                            Button { vm.openDetail(c.id) } label: { countRow(c) }
                                .buttonStyle(.plain)
                                .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Button("New count") { vm.newLabel = ""; vm.showNewCount = true }.padding()
            }
        }
    }

    @ViewBuilder
    private func countRow(_ c: InventoryCountSummary) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(c.label?.isEmpty == false ? c.label! : "Count \(c.id)").font(.callout)
                Text(countMeta(c)).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            statusBadge(open: c.isOpen)
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
    }

    private func countMeta(_ c: InventoryCountSummary) -> String {
        var parts = [c.countDate]
        parts.append("\(c.lineCount) line\(c.lineCount == 1 ? "" : "s")")
        if let cook = c.cookId, !cook.isEmpty { parts.append(cook) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func statusBadge(open: Bool) -> some View {
        Text(open ? "open" : "closed")
            .font(.caption2).padding(4)
            .background((open ? Color.green : Color.secondary).opacity(0.18))
            .clipShape(Capsule())
            .foregroundStyle(open ? Color.green : Color.secondary)
    }

    // ── New-count sheet ──────────────────────────────────────────────────

    @ViewBuilder
    private var newCountForm: some View {
        NavigationStack {
            Form {
                TextField("Label (e.g. Weekly walk-in)", text: $vm.newLabel)
                if let e = vm.actionError { Text(e).font(.caption).foregroundStyle(.red) }
            }
            .navigationTitle("New count")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { vm.showNewCount = false } }
                ToolbarItem(placement: .confirmationAction) { Button("Open") { vm.openCount() } }
            }
        }
        .frame(minWidth: 340, minHeight: 200)
    }

    // ── Detail sheet ──────────────────────────────────────────────────────

    @ViewBuilder
    private var detailSheet: some View {
        NavigationStack {
            Group {
                if let d = vm.selected {
                    detailList(d)
                } else if let e = vm.detailError {
                    TileDegrade(title: "Could not load count", message: e, systemImage: "list.clipboard")
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(detailTitle)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { vm.showDetail = false } }
            }
        }
        .frame(minWidth: 460, minHeight: 520)
    }

    private var detailTitle: String {
        guard let d = vm.selected else { return "Count" }
        return d.head.label?.isEmpty == false ? d.head.label! : "Count \(d.head.id)"
    }

    @ViewBuilder
    private func detailList(_ d: InventoryCountDetail) -> some View {
        List {
            Section {
                HStack {
                    Text(d.head.countDate).font(.callout)
                    Spacer()
                    statusBadge(open: d.head.isOpen)
                }
                .accessibilityElement(children: .combine)
                if d.head.isOpen {
                    Button(role: .destructive) { vm.closeSelected() } label: { Label("Close count", systemImage: "lock") }
                } else {
                    Button { vm.reopenSelected() } label: { Label("Reopen count", systemImage: "lock.open") }
                }
                if let e = vm.actionError { Text(e).font(.callout).foregroundStyle(.red) }
            }

            if d.head.isOpen {
                Section("Add line") {
                    TextField("Ingredient", text: $vm.ingredient)
                    TextField("SKU (optional)", text: $vm.sku)
                    TextField("Vendor (optional)", text: $vm.vendor)
                    TextField("On-hand qty", text: $vm.onHandText)
                    TextField("Unit (e.g. lb, ea)", text: $vm.unit)
                    TextField("Par qty (optional)", text: $vm.parQtyText)
                    TextField("Par unit (optional)", text: $vm.parUnit)
                    TextField("Note (optional)", text: $vm.note)
                    Button("Add line") { vm.addLine() }
                        .disabled(vm.ingredient.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            Section("Lines (\(d.lines.count))") {
                if d.lines.isEmpty {
                    Text("No lines yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(d.lines) { line in lineRow(line) }
                }
            }
        }
    }

    @ViewBuilder
    private func lineRow(_ line: InventoryCountLine) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(line.ingredient).font(.callout)
            Text(lineMeta(line)).font(.caption2).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func lineMeta(_ line: InventoryCountLine) -> String {
        var parts: [String] = []
        if let oh = line.onHandQty { parts.append("on hand \(qty(oh))\(unitSuffix(line.unit))") }
        if let par = line.parQty { parts.append("par \(qty(par))\(unitSuffix(line.parUnit))") }
        if !line.sku.isEmpty { parts.append("SKU \(line.sku)") }
        if let v = line.vendor, !v.isEmpty { parts.append(v) }
        return parts.isEmpty ? "—" : parts.joined(separator: " · ")
    }

    private func qty(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }
    private func unitSuffix(_ u: String?) -> String { (u?.isEmpty == false) ? " \(u!)" : "" }
}
