import SwiftUI
import LariatDB
import LariatModel

/// Native port of `app/purchasing/link/page.jsx` + `LinkPairForm.jsx` — pick a
/// Sysco and a Shamrock catalog item for the same staple, name it, and link
/// both in one audited transaction. "You confirm every link" — no fuzzy
/// matching.
struct VendorLinkView: View {
    @State private var vm: VendorLinkViewModel
    private let navigate: (String) -> Void

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, navigate: @escaping (String) -> Void) {
        _vm = State(wrappedValue: VendorLinkViewModel(readDB: readDB, writeDB: writeDB))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, !vm.loaded {
                TileDegrade(title: "Could not load link vendors", message: err, systemImage: "link")
            } else if !vm.loaded {
                ProgressView("Loading catalogs…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Link vendors")
        .task { await vm.refresh() }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerBar

                Text("Pick a Sysco and Shamrock item for the same staple. You confirm every link.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(alignment: .top, spacing: 16) {
                    catalogPicker(
                        label: "Sysco item",
                        vendor: .sysco,
                        query: $vm.syscoQuery,
                        rows: vm.syscoRows,
                        selection: vm.selectedSysco,
                        onPick: { vm.selectedSysco = $0 }
                    )
                    catalogPicker(
                        label: "Shamrock item",
                        vendor: .shamrock,
                        query: $vm.shamrockQuery,
                        rows: vm.shamrockRows,
                        selection: vm.selectedShamrock,
                        onPick: { vm.selectedShamrock = $0 }
                    )
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Staple name").font(.headline)
                    TextField("Chicken Breast", text: $vm.canonicalName)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 420)
                        .accessibilityLabel("Staple name")
                }

                Button(vm.isSaving ? "Saving…" : "Link both vendors") {
                    vm.requestSubmit()
                }
                .disabled(!vm.canSubmit)
                .keyboardShortcut(.defaultAction)

                if let errorMessage = vm.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(LariatTheme.bad)
                }
                if vm.linkedMasterId != nil {
                    HStack(spacing: 6) {
                        Text("Linked.")
                            .foregroundStyle(LariatTheme.ok)
                        Button("View on compare") { navigate("purchasing.compare") }
                            .buttonStyle(.link)
                    }
                    .font(.caption)
                }
            }
            .padding()
        }
    }

    @ViewBuilder
    private var headerBar: some View {
        HStack(spacing: 12) {
            if let c = vm.coverage {
                Text("\(c.mappedPairs) mapped · \(c.singleVendor) on one vendor · \(c.unlinkedSysco) Sysco unlinked · \(c.unlinkedShamrock) Shamrock unlinked")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Order guide") { navigate("purchasing.orderGuide") }
                .buttonStyle(.link)
            Button("Compare") { navigate("purchasing.compare") }
                .buttonStyle(.link)
        }
    }

    /// `CatalogPicker` from LinkPairForm.jsx: search field + unlinked rows,
    /// picked row highlighted.
    @ViewBuilder
    private func catalogPicker(
        label: String,
        vendor: CompareVendor,
        query: Binding<String>,
        rows: [CatalogRow],
        selection: CatalogRow?,
        onPick: @escaping (CatalogRow) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.headline)
            TextField("Search catalog", text: query)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await vm.loadCatalog(vendor) } }
                .onChange(of: query.wrappedValue) { _, _ in
                    Task { await vm.loadCatalog(vendor) }
                }
            if rows.isEmpty {
                EmptyState(message: "No unlinked \(vendor.rawValue) items match.", systemImage: "magnifyingglass")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(rows) { row in
                            let isSelected = selection?.id == row.id
                            Button {
                                onPick(row)
                            } label: {
                                HStack {
                                    Text(row.ingredient)
                                    if let packLabel = row.packLabel {
                                        Text("· \(packLabel)").foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if isSelected {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(LariatTheme.ok)
                                    }
                                }
                                .contentShape(Rectangle())
                                .padding(.vertical, 3)
                                .padding(.horizontal, 6)
                                .background(isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel(row.ingredient + (row.packLabel.map { " · \($0)" } ?? ""))
                            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
