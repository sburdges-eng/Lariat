import SwiftUI
import LariatDB
import LariatModel
#if canImport(AppKit)
import AppKit
#endif

/// Native port of `app/purchasing/page.jsx` — the read-only order-guide hub.
/// Shows the first 200 items with preferred/lock/mismatch badges and links to
/// the compare and link boards. The Print preview is a native-only nicety
/// (no web equivalent) rendered from `PurchasingOrderGuidePrintCompute`,
/// following the `ShowSettlementView` / `SettlementPrintCompute` pattern.
struct PurchasingOrderGuideView: View {
    @State private var vm: PurchasingOrderGuideViewModel
    @State private var showPrintPreview = false
    private let navigate: (String) -> Void

    init(database: LariatDatabase, navigate: @escaping (String) -> Void) {
        _vm = State(wrappedValue: PurchasingOrderGuideViewModel(database: database))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.summary == nil {
                TileDegrade(title: "Could not load the order guide", message: err, systemImage: "list.clipboard")
            } else if vm.summary == nil {
                ProgressView("Loading order guide…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Order guide")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .searchable(text: $vm.query, prompt: "Find an ingredient or vendor")
        .sheet(isPresented: $showPrintPreview) { printPreview }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerBar

            if vm.summary?.totalCount == 0 {
                EmptyState(
                    message: "No order guide yet. Drop the operations workbook in place and run the ingest — this board picks it up automatically.",
                    systemImage: "tray"
                )
                .padding()
            } else if vm.filteredRows.isEmpty {
                EmptyState(message: "No items match the search.", systemImage: "magnifyingglass")
                    .padding()
            } else {
                guideTable
            }
        }
    }

    @ViewBuilder
    private var headerBar: some View {
        HStack(spacing: 12) {
            Text("From the Order Guide sheet (\(vm.summary?.totalCount ?? 0) items). Refreshes automatically after the operations workbook is updated.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Sysco vs Shamrock") { navigate("purchasing.compare") }
                .buttonStyle(.link)
            Button("Link vendors") { navigate("purchasing.link") }
                .buttonStyle(.link)
            Button("Print preview") { showPrintPreview = true }
                .disabled(vm.summary == nil)
        }
        .padding()
    }

    @ViewBuilder
    private var guideTable: some View {
        Table(vm.filteredRows) {
            TableColumn("Ingredient") { item in
                Text(item.row.ingredient)
            }
            TableColumn("Base qty") { item in
                Text(item.row.baseQty.map { qtyString($0) } ?? "—")
                    .foregroundStyle(item.row.baseQty == nil ? .secondary : .primary)
            }
            TableColumn("Unit") { item in
                Text(item.row.unit ?? "—")
            }
            TableColumn("Vendor") { item in
                Text(item.row.vendor ?? "—")
            }
            TableColumn("Unit $") { item in
                Text(item.row.unitPrice.map { formatDollars($0, decimals: 2) } ?? "—")
                    .foregroundStyle(item.row.unitPrice == nil ? .secondary : .primary)
            }
            TableColumn("Notes") { item in
                notesBadges(item.enrichment)
            }
        }
    }

    /// The web page's `String(r.base_qty)` — integers without a trailing ".0".
    private func qtyString(_ qty: Double) -> String {
        if qty == qty.rounded(.towardZero), abs(qty) < 1e15 {
            return String(Int64(qty))
        }
        return String(qty)
    }

    /// Pref / Locked / Mismatch badges (page.jsx L58-70).
    @ViewBuilder
    private func notesBadges(_ enrichment: OrderGuideEnrichment?) -> some View {
        HStack(spacing: 6) {
            if let preferred = enrichment?.preferredVendor {
                Text("Pref \(preferred)")
                    .font(.caption)
                    .help("Preferred vendor")
            }
            if enrichment?.qualityLocked == true {
                Label("Locked", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(LariatTheme.warn)
                    .help(enrichment?.qualityLockReason ?? "quality")
            }
            if enrichment?.vendorMismatch == true {
                Text("Mismatch")
                    .font(.caption)
                    .foregroundStyle(LariatTheme.warn)
                    .help("Guide vendor differs from preferred")
            }
        }
        .accessibilityElement(children: .combine)
    }

    // ── Print preview (orderGuidePrint computation) ────────────────────

    @ViewBuilder
    private var printPreview: some View {
        NavigationStack {
            ScrollView {
                if let s = vm.summary {
                    Text(PurchasingOrderGuidePrintCompute.renderText(s))
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
            }
            .navigationTitle("Order guide sheet")
            .toolbar {
                #if canImport(AppKit)
                ToolbarItem {
                    Button("Copy") {
                        if let s = vm.summary {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(
                                PurchasingOrderGuidePrintCompute.renderText(s), forType: .string)
                        }
                    }
                    .disabled(vm.summary == nil)
                }
                ToolbarItem {
                    Button("Print") {
                        if let s = vm.summary { Self.printOrderGuide(s) }
                    }
                    .disabled(vm.summary == nil)
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
    /// Print the SAME monospaced order-guide text the preview renders —
    /// `PurchasingOrderGuidePrintCompute.renderText` stays the single
    /// computation.
    private static func printOrderGuide(_ s: OrderGuideSummary) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 486, height: 700))
        textView.string = PurchasingOrderGuidePrintCompute.renderText(s)
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        let operation = NSPrintOperation(view: textView)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }
    #endif
}
