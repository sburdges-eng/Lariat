import SwiftUI
import LariatDB
import LariatModel

/// Native port of `/bar/par` — beer, wine, liquor & cocktail ingredients on
/// hand, grouped by category with a below-par flag. Read-only by design
/// (adds happen on the inventory par board). Note: Shamrock-imported par
/// rows carry no category, so an empty board is legitimate until categories
/// are populated through the par form.
struct BarParView: View {
    @State private var vm: BarParViewModel
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
                Button("Bar program") { navigate("house.bar") }
            }
        }
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
                Section {
                    EmptyState(
                        message: vm.showLowOnly ? "Nothing below par." : "No bar par list yet.",
                        systemImage: "wineglass"
                    )
                }
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
}
