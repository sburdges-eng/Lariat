import SwiftUI
import LariatDB
import LariatModel
#if canImport(AppKit)
import AppKit
#endif

/// Inventory PAR board — native port of `app/inventory/par/page.jsx`. Standing
/// par levels per ingredient, grouped by category, each showing the latest
/// counted on-hand with a "below par" flag. Reads open; add/remove are audited
/// (no PIN — /inventory is unregulated).
struct InventoryParView: View {
    @State private var vm: InventoryParViewModel
    @State private var showPrintPreview = false

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
        .toolbar {
            ToolbarItem {
                // `InventoryParViewModel` has no `loaded` latch like
                // `BarParViewModel` (do not touch the ViewModel to add one —
                // out of scope here), so this reconstructs the same intent
                // from state already exposed to the view: disabled only
                // during the pre-first-load window (no rows yet AND no
                // fetch error yet). Once either arrives — success or
                // failure — printing is allowed, matching `BarParView`'s gate.
                Button("Print preview") { showPrintPreview = true }
                    .disabled(vm.rows.isEmpty && vm.fetchError == nil)
            }
        }
        .sheet(isPresented: $vm.showForm) { addForm }
        .sheet(isPresented: $showPrintPreview) { printPreview }
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
        .accessibilityElement(children: .combine)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { vm.remove(row.par.id) } label: { Label("Remove", systemImage: "trash") }
                .accessibilityLabel("Remove \(row.par.ingredient)")
        }
        // Mouse-reachable delete: on macOS swipe actions need a trackpad swipe,
        // so right-click must offer the same Remove.
        .contextMenu {
            Button(role: .destructive) { vm.remove(row.par.id) } label: { Label("Remove", systemImage: "trash") }
                .accessibilityLabel("Remove \(row.par.ingredient)")
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

    // ── Print preview (ParPrintCompute.renderText — shared with BarParView) ──

    /// Maps the currently visible (below-par-filtered) `vm.grouped` rows into
    /// the board-agnostic `ParPrintCompute` inputs. `InventoryParWithOnHand`
    /// tracks par and on-hand quantities in separate units (`par.parUnit` /
    /// `onHandUnit`) that can legitimately differ, so both pass through to
    /// the renderer independently rather than collapsing to one shared unit
    /// — same rule as `BarParView.printGroups`.
    private var printGroups: [ParPrintGroup] {
        vm.grouped.map { group in
            ParPrintGroup(
                category: group.category,
                rows: group.rows.map { row in
                    ParPrintRow(
                        name: row.par.ingredient,
                        par: row.par.parQty,
                        onHand: row.onHandQty,
                        parUnit: row.par.parUnit,
                        onHandUnit: row.onHandUnit,
                        belowPar: row.isLow
                    )
                }
            )
        }
    }

    @ViewBuilder
    private var printPreview: some View {
        NavigationStack {
            ScrollView {
                Text(ParPrintCompute.renderText(title: "INVENTORY PAR", groups: printGroups))
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle("Par sheet")
            .toolbar {
                #if canImport(AppKit)
                ToolbarItem {
                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(
                            ParPrintCompute.renderText(title: "INVENTORY PAR", groups: printGroups),
                            forType: .string)
                    }
                }
                ToolbarItem {
                    Button("Print") { Self.printInventoryPar(printGroups) }
                }
                #endif
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showPrintPreview = false }
                }
            }
        }
        .frame(minWidth: 520, minHeight: 560)
    }

    #if canImport(AppKit)
    /// Print the SAME monospaced text the preview renders —
    /// `ParPrintCompute.renderText` stays the single computation shared with
    /// `BarParView`.
    private static func printInventoryPar(_ groups: [ParPrintGroup]) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 486, height: 700))
        textView.string = ParPrintCompute.renderText(title: "INVENTORY PAR", groups: groups)
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        let operation = NSPrintOperation(view: textView)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }
    #endif

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
