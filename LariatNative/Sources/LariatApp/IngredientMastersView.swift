import SwiftUI
import LariatDB
import LariatModel

/// Native port of `app/costing/ingredient-masters/page.jsx` — the main
/// ingredient list, the link between vendor prices and recipe costs. Search /
/// filter by master id or canonical name; "Mark reviewed" stamps
/// `last_reviewed = datetime('now')` (the one audited write on this board).
///
/// In-place editing of canonical_name/category/preferred_vendor is supported
/// by the repository (`updateMaster`) but, matching the web page, this view
/// shows those columns read-only — a future "Edit" affordance can reuse the
/// same repository call without further backend changes.
struct IngredientMastersView: View {
    @State private var vm: IngredientMastersViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase?) {
        _vm = State(wrappedValue: IngredientMastersViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load ingredient masters", message: err, systemImage: "shippingbox")
            } else {
                content
            }
        }
        .navigationTitle("Ingredient masters")
        .task { await vm.refresh() }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            filterBar

            if !vm.canWrite {
                Label("Write database unavailable — read-only. \u{201c}Mark reviewed\u{201d} is disabled.", systemImage: "lock")
                    .font(.caption)
                    .foregroundStyle(LariatTheme.warn)
                    .padding(.horizontal)
            }

            if let actionError = vm.actionError {
                Text(actionError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal)
            }

            if vm.rows.isEmpty {
                TileDegrade(
                    title: "No masters match the current filter",
                    message: "Adjust the search or filter above.",
                    systemImage: "magnifyingglass"
                )
                .padding()
            } else {
                table
            }
        }
    }

    @ViewBuilder
    private var filterBar: some View {
        HStack(spacing: 12) {
            TextField("Search by master id or canonical name…", text: $vm.query)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 260)
                .onSubmit { Task { await vm.refresh() } }

            Picker("Filter", selection: $vm.filter) {
                Text("Needs review").tag(IngredientMasterFilter.needsReview)
                Text("Reviewed").tag(IngredientMasterFilter.reviewed)
                Text("All").tag(IngredientMasterFilter.all)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 320)
            .onChange(of: vm.filter) { _, _ in Task { await vm.refresh() } }

            Spacer()

            Text("\(vm.rows.count) shown")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
    }

    @ViewBuilder
    private var table: some View {
        Table(vm.rows) {
            TableColumn("Master") { row in
                Text(row.masterId).font(.system(.caption, design: .monospaced))
            }
            TableColumn("Canonical name") { row in
                Text(row.canonicalName)
            }
            TableColumn("Category") { row in
                Text(row.category ?? "—").foregroundStyle(row.category == nil ? .secondary : .primary)
            }
            TableColumn("Pref. vendor") { row in
                Text(row.preferredVendor ?? "—").foregroundStyle(row.preferredVendor == nil ? .secondary : .primary)
            }
            TableColumn("VP") { row in
                Text("\(row.vendorPriceCount)")
            }
            TableColumn("BOM") { row in
                Text("\(row.bomLineCount)")
            }
            TableColumn("Reviewed") { row in
                Text(row.lastReviewed ?? "—").foregroundStyle(row.lastReviewed == nil ? .secondary : .primary)
            }
            TableColumn("Action") { row in
                Button("Mark reviewed") {
                    Task { await vm.markReviewed(masterId: row.masterId) }
                }
                .disabled(vm.isSaving || !vm.canWrite)
                .help(vm.canWrite ? "Stamp last_reviewed = now" : "Write database unavailable — read-only")
            }
        }
    }
}
