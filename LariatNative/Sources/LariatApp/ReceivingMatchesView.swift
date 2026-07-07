import SwiftUI
import LariatDB
import LariatModel

/// Native port of `app/management/receiving-matches/page.jsx` — the manager
/// queue for accepted delivery lines that captured qty/unit but could not be
/// tied to an ingredient master at check-in. Pick a master, "Set master" —
/// one transaction re-points the row, backfills the inventory credit, and
/// writes both audit rows.
struct ReceivingMatchesView: View {
    @State private var vm: ReceivingMatchesViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: ReceivingMatchesViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.queue.isEmpty {
                TileDegrade(title: "Could not load receiving matches", message: err, systemImage: "shippingbox")
            } else if !vm.loaded {
                ProgressView("Loading receiving matches…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if vm.queue.isEmpty {
                // Page: "All caught up".
                TileDegrade(
                    title: "All caught up",
                    message: "No accepted delivery lines need a master ingredient.",
                    systemImage: "checkmark.seal"
                )
            } else {
                content
            }
        }
        .navigationTitle("Receiving matches")
        .searchable(text: $vm.searchText, prompt: "Search vendor, item, SKU…")
        .task { await vm.refresh() }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Waiting (\(vm.visibleQueue.count))")
                    .font(.headline)
                Spacer()
                Button("Refresh") { Task { await vm.refresh() } }
            }
            .padding()

            if let errorMessage = vm.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(LariatTheme.warn)
                    .padding(.horizontal)
            }

            List(vm.visibleQueue) { row in
                matchRow(row)
            }
            .listStyle(.inset)
        }
    }

    @ViewBuilder
    private func matchRow(_ row: ReceivingRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.vendor).fontWeight(.medium)
                    if let invoice = row.invoiceRef {
                        Text(invoice).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(row.item ?? "-")
                if let sku = row.vendorSku {
                    Text(sku).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                }
                Spacer()
                Text(vm.qtyText(row)).font(.callout.bold())
                Text(vm.reasonText(row))
                    .font(.caption.bold())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(LariatTheme.warn.opacity(0.15), in: Capsule())
                    .foregroundStyle(LariatTheme.warn)
                if let created = row.createdAt {
                    Text(created).font(.caption).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)

            HStack(spacing: 10) {
                Picker("Master ingredient", selection: Binding(
                    get: { vm.selections[row.id] ?? "" },
                    set: { vm.selections[row.id] = $0 }
                )) {
                    Text("Choose one").tag("")
                    ForEach(vm.masters) { master in
                        Text(master.canonicalName).tag(master.masterId)
                    }
                }
                .frame(maxWidth: 340)

                Button(vm.isSaving ? "Saving…" : "Set master") {
                    vm.requestResolve(row)
                }
                .disabled(!vm.canResolve(row))

                if let picked = vm.selections[row.id], !picked.isEmpty {
                    Text(picked)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
