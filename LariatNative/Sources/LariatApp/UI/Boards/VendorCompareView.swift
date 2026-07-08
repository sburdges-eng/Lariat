import SwiftUI
import LariatDB
import LariatModel

/// Native port of `app/purchasing/compare/page.jsx` — the Sysco vs Shamrock
/// board. Comparable pairs show normalized $/unit with the cheaper side
/// highlighted; incomparable offers show the web's reason labels. Row actions
/// mirror `CompareActions.jsx` (Use Sysco / Use Shamrock / Lock / Unlock) and
/// the "One vendor only" section mirrors `AttachVendorActions.jsx`.
struct VendorCompareView: View {
    @State private var vm: VendorCompareViewModel
    private let navigate: (String) -> Void

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, navigate: @escaping (String) -> Void) {
        _vm = State(wrappedValue: VendorCompareViewModel(readDB: readDB, writeDB: writeDB))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.summary == nil {
                TileDegrade(title: "Could not load vendor compare", message: err, systemImage: "scalemass")
            } else if vm.summary == nil {
                ProgressView("Loading vendor compare…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Sysco vs Shamrock")
        .task { await vm.refresh() }
        .searchable(text: $vm.query, prompt: "Find a staple")
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
        .sheet(item: $vm.attachTarget) { target in
            attachSheet(target)
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerBar

            if let actionError = vm.actionError {
                Text(actionError)
                    .font(.caption)
                    .foregroundStyle(LariatTheme.bad)
                    .padding(.horizontal)
            }

            if vm.filteredRows.isEmpty {
                EmptyState(
                    message: "No mapped pairs yet — link a Sysco and Shamrock item to compare prices.",
                    systemImage: "link"
                )
                .padding()
            } else {
                compareTable
            }

            if !vm.singles.isEmpty {
                singlesSection
            }
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
            Button("Link vendors") { navigate("purchasing.link") }
                .buttonStyle(.link)
        }
        .padding()
    }

    @ViewBuilder
    private var compareTable: some View {
        Table(vm.filteredRows) {
            TableColumn("Item") { row in
                Text(row.canonicalName)
            }
            TableColumn("Sysco") { row in
                offerText(row.sysco, highlighted: row.cheaperVendor == .sysco)
            }
            TableColumn("Shamrock") { row in
                offerText(row.shamrock, highlighted: row.cheaperVendor == .shamrock)
            }
            TableColumn("Preferred") { row in
                Text(row.preferredVendor ?? "—")
                    .foregroundStyle(row.preferredVendor == nil ? .secondary : .primary)
            }
            TableColumn("Lock") { row in
                if row.qualityLocked {
                    Label("Locked", systemImage: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(LariatTheme.warn)
                        .help(row.qualityLockReason ?? "quality")
                } else {
                    Text("—").foregroundStyle(.secondary)
                }
            }
            TableColumn("Actions") { row in
                rowActions(row)
            }
        }
    }

    /// `fmtPrice` + `reasonLabel` from the web page.
    @ViewBuilder
    private func offerText(_ offer: VendorOfferSnapshot?, highlighted: Bool) -> some View {
        if let offer, offer.status == .ok, let price = offer.normalizedPrice {
            let unit = offer.normalizedUnit.map { "/\($0)" } ?? ""
            Text("\(formatDollars(price, decimals: 2))\(unit)")
                .fontWeight(highlighted ? .semibold : .regular)
                .foregroundStyle(highlighted ? LariatTheme.ok : Color.primary)
                .accessibilityLabel("\(formatDollars(price, decimals: 2))\(unit)\(highlighted ? ", cheaper" : "")")
        } else {
            Text(Self.reasonLabel(offer?.reason))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    /// `reasonLabel` (compare/page.jsx L19-24).
    static func reasonLabel(_ reason: String?) -> String {
        switch reason {
        case "unit_mismatch": return "different pack"
        case "need_density": return "need weight bridge"
        case "count_bridge": return "count item"
        default: return "can't compare"
        }
    }

    @ViewBuilder
    private func rowActions(_ row: VendorCompareRow) -> some View {
        HStack(spacing: 6) {
            if row.qualityLocked {
                Button("Unlock") { vm.requestUnlock(masterId: row.masterId) }
                    .accessibilityLabel("Unlock \(row.canonicalName)")
            } else {
                Button("Use Sysco") { vm.requestSetPreferred(masterId: row.masterId, vendor: .sysco) }
                    .accessibilityLabel("Use Sysco for \(row.canonicalName)")
                Button("Use Shamrock") { vm.requestSetPreferred(masterId: row.masterId, vendor: .shamrock) }
                    .accessibilityLabel("Use Shamrock for \(row.canonicalName)")
                Button("Lock for quality") { vm.requestLock(masterId: row.masterId, currentPreferred: row.preferredVendor) }
                    .accessibilityLabel("Lock \(row.canonicalName) for quality")
            }
        }
        .buttonStyle(.borderless)
        .font(.caption)
        .disabled(vm.isSaving)
    }

    // ── "One vendor only" (compare/page.jsx L103-133) ────────────────────

    @ViewBuilder
    private var singlesSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("One vendor only")
                .font(.headline)
                .padding(.horizontal)
            ForEach(vm.singles) { single in
                HStack {
                    HStack(spacing: 4) {
                        Text(single.canonicalName)
                        Text("has \(single.linkedVendor.rawValue)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    Spacer()
                    Button("Attach \(single.missingVendor.rawValue)") {
                        vm.attachTarget = single
                        vm.attachQuery = ""
                        Task { await vm.loadAttachCandidates() }
                    }
                    .disabled(vm.isSaving)
                    .accessibilityLabel("Attach \(single.missingVendor.rawValue) for \(single.canonicalName)")
                }
                .padding(.horizontal)
                .padding(.vertical, 2)
            }
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private func attachSheet(_ target: SingleVendorMaster) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pick a \(target.missingVendor.rawValue) item for \(target.canonicalName)")
                .font(.headline)
            TextField("Search catalog", text: $vm.attachQuery)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await vm.loadAttachCandidates() } }
                .onChange(of: vm.attachQuery) { _, _ in
                    Task { await vm.loadAttachCandidates() }
                }
            if vm.attachRows.isEmpty {
                EmptyState(message: "No unlinked \(target.missingVendor.rawValue) items match.", systemImage: "magnifyingglass")
            } else {
                List(vm.attachRows) { row in
                    Button {
                        vm.requestAttach(row: row)
                    } label: {
                        HStack {
                            Text(row.ingredient)
                            if let label = row.packLabel {
                                Text("· \(label)").foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                }
                .frame(minHeight: 200)
            }
            if let actionError = vm.actionError {
                Text(actionError).font(.caption).foregroundStyle(LariatTheme.bad)
            }
            HStack {
                Spacer()
                Button("Cancel") { vm.attachTarget = nil }
            }
        }
        .padding(24)
        .frame(minWidth: 420, minHeight: 320)
    }
}
