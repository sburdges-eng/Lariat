import SwiftUI
import LariatDB
import LariatModel
#if canImport(AppKit)
import AppKit
#endif

/// Native port of `/bar/par` — beer, wine, liquor & cocktail ingredients on
/// hand, grouped by category with a below-par flag. Read-only by design
/// (adds happen on the inventory par board). Note: Shamrock-imported par
/// rows carry no category, so an empty board is legitimate until categories
/// are populated through the par form.
struct BarParView: View {
    @State private var vm: BarParViewModel
    @State private var showPrintPreview = false
    private let navigate: (String) -> Void

    init(readDB: LariatDatabase, navigate: @escaping (String) -> Void) {
        _vm = State(wrappedValue: BarParViewModel(readDB: readDB))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.rows.isEmpty {
                TileDegrade(title: "Could not load bar par", message: err, systemImage: "shippingbox")
            } else if !vm.loaded {
                ProgressView("Loading bar par…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Bar par")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .toolbar {
            ToolbarItem {
                Button("Print preview") { showPrintPreview = true }
                    .disabled(!vm.loaded)
            }
            ToolbarItem {
                Button("Bar program") { navigate("house.bar") }
            }
        }
        .sheet(isPresented: $showPrintPreview) { printPreview }
    }

    @ViewBuilder
    private var content: some View {
        List {
            Section {
                Picker("Filter", selection: $vm.showLowOnly) {
                    Text("All (\(vm.allCount))").tag(false)
                    Text("Low (\(vm.lowCount))").tag(true)
                }
                .pickerStyle(.segmented)
                if vm.lowCount > 0 {
                    Text("\(vm.lowCount) item\(vm.lowCount == 1 ? "" : "s") below par.")
                        .font(.caption)
                        .foregroundStyle(LariatTheme.warn)
                }
            }
            let groups = vm.grouped
            if groups.isEmpty {
                Section { emptySection }
            } else {
                ForEach(groups, id: \.category) { group in
                    Section(group.category) {
                        ForEach(group.rows) { row in
                            parRow(row)
                        }
                    }
                }
            }
        }
        .searchable(text: $vm.searchText, prompt: "Search bar items")
    }

    /// Honest empty states: "nothing low", "search missed", "par list
    /// exists but nothing is categorized as a beverage yet" (Shamrock rows
    /// import with NULL category — point at the inventory par board where
    /// categories are set), and only then "no par list yet".
    @ViewBuilder
    private var emptySection: some View {
        if vm.showLowOnly {
            EmptyState(message: "Nothing below par.", systemImage: "wineglass")
        } else if !vm.rows.isEmpty {
            EmptyState(message: "No bar items match the search.", systemImage: "magnifyingglass")
        } else if vm.totalParCount > 0 {
            EmptyState(
                message: "\(vm.totalParCount) par item\(vm.totalParCount == 1 ? " exists" : "s exist") "
                    + "but none are categorized as beer, wine, or liquor — "
                    + "set categories on the inventory par board.",
                systemImage: "wineglass"
            )
            Button("Open the inventory par board") { navigate("inventory.par") }
                .font(.caption)
        } else {
            EmptyState(message: "No bar par list yet.", systemImage: "wineglass")
        }
    }

    @ViewBuilder
    private func parRow(_ row: BarParRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.ingredient).font(.callout)
                Text(metaLine(row))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if row.isLow {
                Text("low")
                    .font(.caption2.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(LariatTheme.warn.opacity(0.2), in: Capsule())
                    .foregroundStyle(LariatTheme.warn)
            }
        }
        .padding(.vertical, 1)
        .accessibilityElement(children: .combine)
    }

    private func metaLine(_ row: BarParRow) -> String {
        var parts: [String] = []
        if let vendor = row.vendor, !vendor.isEmpty { parts.append(vendor) }
        parts.append("par \(row.parQty.map(qty) ?? "—") \(row.parUnit ?? "")".trimmingCharacters(in: .whitespaces))
        if let onHand = row.onHandQty {
            parts.append("on hand \(qty(onHand)) \(row.onHandUnit ?? "")".trimmingCharacters(in: .whitespaces))
        } else {
            parts.append("on hand —")
        }
        if let counted = row.countedAt, !counted.isEmpty {
            parts.append(shortDate(counted))
        }
        return parts.joined(separator: " · ")
    }

    private func qty(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(v)
    }

    /// `fmtDate` parity: 'MMM d' from a UTC `datetime('now')` string.
    private func shortDate(_ iso: String) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
        fmt.timeZone = TimeZone(identifier: "UTC")
        guard let date = fmt.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US")
        out.dateFormat = "MMM d"
        return out.string(from: date)
    }

    // ── Print preview (ParPrintCompute.renderText — shared with InventoryParView) ──

    /// Maps the currently visible (filter/search-applied) `vm.grouped` rows
    /// into the board-agnostic `ParPrintCompute` inputs. A `BarParRow` tracks
    /// its par and on-hand quantities in separate units (`parUnit` /
    /// `onHandUnit`) that can legitimately differ; the shared renderer has a
    /// single `unit` column, so this prefers the standing `parUnit`, falling
    /// back to `onHandUnit` when the par row itself has none.
    private var printGroups: [ParPrintGroup] {
        vm.grouped.map { group in
            ParPrintGroup(
                category: group.category,
                rows: group.rows.map { row in
                    ParPrintRow(
                        name: row.ingredient,
                        par: row.parQty,
                        onHand: row.onHandQty,
                        unit: row.parUnit ?? row.onHandUnit,
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
                Text(ParPrintCompute.renderText(title: "BAR PAR", groups: printGroups))
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle("Bar par sheet")
            .toolbar {
                #if canImport(AppKit)
                ToolbarItem {
                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(
                            ParPrintCompute.renderText(title: "BAR PAR", groups: printGroups),
                            forType: .string)
                    }
                }
                ToolbarItem {
                    Button("Print") { Self.printBarPar(printGroups) }
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
    /// `InventoryParView`.
    private static func printBarPar(_ groups: [ParPrintGroup]) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 486, height: 700))
        textView.string = ParPrintCompute.renderText(title: "BAR PAR", groups: groups)
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        let operation = NSPrintOperation(view: textView)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }
    #endif
}
