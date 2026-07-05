import SwiftUI
import LariatDB
import LariatModel

struct EightySixView: View {
    @State private var vm: EightySixViewModel
    @State private var item = ""
    @State private var stationId = ""
    @State private var reason: EightySixReasonCode = .out
    @State private var quantity = ""
    @State private var query = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, catalog: StationCatalog) {
        _vm = State(
            wrappedValue: EightySixViewModel(readDB: readDB, writeDB: writeDB, catalog: catalog)
        )
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load 86", message: err, systemImage: "externaldrive.badge.xmark")
            } else if let snap = vm.snapshot {
                boardContent(snap)
            } else {
                ProgressView("Loading 86 board…")
            }
        }
        .navigationTitle("86")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable,
                onDismiss: { vm.showCookPicker = false },
                onCancel: { vm.actionError = "Not saved — pick a cook to record the 86." }
            )
        }
    }

    // ── Cook-gated submits (fields clear ONLY on a committed write; an
    //    identity interrupt stashes the same submit for auto-retry) ──────

    private func submitAdd() async {
        let ok = await vm.add(item: item, stationId: stationId, reason: reason, quantity: quantity)
        if ok {
            item = ""
            quantity = ""
        } else if vm.showCookPicker {
            vm.cookStore.stashPendingWrite { await submitAdd() }
        }
    }

    private func submitResolve(id: Int64) async {
        let ok = await vm.resolve(id: id)
        if !ok, vm.showCookPicker {
            vm.cookStore.stashPendingWrite { await submitResolve(id: id) }
        }
    }

    private func submitCascadeConfirm(_ recipe: CascadedRecipe) async {
        let ok = await vm.confirmCascadeAdd(recipe)
        if !ok, vm.showCookPicker {
            vm.cookStore.stashPendingWrite { await submitCascadeConfirm(recipe) }
        }
    }

    @ViewBuilder
    private func boardContent(_ snap: EightySixBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header(snap)
                addForm
                if let err = vm.actionError {
                    Text(err).font(.subheadline).foregroundStyle(.red)
                }
                if !snap.cascaded.isEmpty {
                    cascadeSection(snap.cascaded)
                }
                activeSection(filtered(snap.active), totalCount: snap.active.count)
                let resolved = filtered(snap.resolved)
                if !resolved.isEmpty {
                    resolvedSection(resolved)
                }
            }
            .padding()
        }
        .searchable(text: $query, prompt: "Find an item")
    }

    private func filtered(_ rows: [EightySixRow]) -> [EightySixRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.item.localizedCaseInsensitiveContains(q) }
    }

    private func header(_ snap: EightySixBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("86 board")
                .font(.largeTitle.bold())
            Text(openLabel(snap.active.count))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mark out").font(.headline)
            TextField("Item", text: $item)
                .textFieldStyle(.roundedBorder)
            Picker("Station", selection: $stationId) {
                Text("Any station").tag("")
                ForEach(vm.stations, id: \.id) { station in
                    Text(station.name).tag(station.id)
                }
            }
            Picker("Reason", selection: $reason) {
                ForEach(EightySixReasonCode.allCases) { code in
                    Text(code.label).tag(code)
                }
            }
            TextField("Qty (optional)", text: $quantity)
                .textFieldStyle(.roundedBorder)
            Button(vm.isSaving ? "Saving…" : "86 now") {
                Task { await submitAdd() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(vm.isSaving || item.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .frame(minHeight: 44)
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private func cascadeSection(_ cascaded: [CascadedRecipe]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Also hits the menu").font(.headline)
            ForEach(cascaded, id: \.slug) { recipe in
                if vm.confirmCascade?.slug == recipe.slug {
                    HStack {
                        Text(recipe.name)
                        Spacer()
                        Button("Confirm") {
                            Task { await submitCascadeConfirm(recipe) }
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityLabel("Confirm adding \(recipe.name)")
                        Button("Cancel") { vm.confirmCascade = nil }
                            .accessibilityLabel("Cancel adding \(recipe.name)")
                    }
                } else {
                    Button {
                        vm.confirmCascade = recipe
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(recipe.name).font(.headline)
                                Text("via \(recipe.via)").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "plus.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(recipe.name), via \(recipe.via)")
                }
            }
        }
        .padding()
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }

    private func activeSection(_ rows: [EightySixRow], totalCount: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Out now").font(.headline)
            if rows.isEmpty {
                if totalCount > 0 {
                    EmptyState(message: "No items match “\(query)”", systemImage: "magnifyingglass")
                } else {
                    EmptyState(message: "Nothing out right now", systemImage: "checkmark.circle")
                }
            } else {
                ForEach(rows) { row in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.item).font(.headline)
                            if let meta = activeMeta(row) {
                                Text(meta).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        Spacer()
                        Button(vm.isResolving(row.id) ? "…" : "Back on menu") {
                            Task { await submitResolve(id: row.id) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(vm.isResolving(row.id))
                        .accessibilityLabel("Put \(row.item) back on the menu")
                    }
                    .padding(10)
                    .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    private func resolvedSection(_ rows: [EightySixRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Resolved today (\(rows.count))").font(.headline)
            ForEach(rows) { row in
                HStack {
                    Text(row.item)
                    Spacer()
                    if let meta = resolvedMeta(row) {
                        Text(meta).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(8)
                .background(.background.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityElement(children: .combine)
            }
        }
        .padding()
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    private func openLabel(_ count: Int) -> String {
        count == 1 ? "1 item out" : "\(count) items out"
    }

    // ── Row meta (render the data already on EightySixRow) ─────────────

    /// Active-row subtitle: reason · station · qty · cook · time-out.
    private func activeMeta(_ row: EightySixRow) -> String? {
        var parts: [String] = []
        if let reason = row.reason, !reason.isEmpty { parts.append(reason) }
        if let station = row.stationId, !station.isEmpty { parts.append(stationName(station)) }
        if let qty = row.quantity, !qty.isEmpty { parts.append("qty \(qty)") }
        if let cook = row.cookId, !cook.isEmpty { parts.append(cook) }
        if let t = fmtTime(row.createdAt) { parts.append(t) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Resolved-row subtitle: reason · back-on time.
    private func resolvedMeta(_ row: EightySixRow) -> String? {
        var parts: [String] = []
        if let reason = row.reason, !reason.isEmpty { parts.append(reason) }
        if let t = fmtTime(row.resolvedAt) { parts.append("back \(t)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// Station display name via the catalog (falls back to the raw id).
    private func stationName(_ id: String) -> String {
        vm.stations.first { $0.id == id }?.name ?? id
    }

    // SQLite datetime is stored UTC ("yyyy-MM-dd HH:mm:ss"); ISO-8601 also possible.
    // Parse as UTC and render a short LOCAL time (mirrors the web fmtTime posture).
    private static let sqliteUTC: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()
    private static let shortLocalTime: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "h:mm a"     // local time zone (formatter default)
        return f
    }()

    private func fmtTime(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        var date = Self.sqliteUTC.date(from: raw)
        if date == nil {
            let iso = ISO8601DateFormatter()
            date = iso.date(from: raw)
        }
        if date == nil {
            let isoFrac = ISO8601DateFormatter()
            isoFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            date = isoFrac.date(from: raw)
        }
        guard let d = date else { return nil }
        return Self.shortLocalTime.string(from: d)
    }
}
