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
                LaRiOSLoadingView(message: "Loading 86")
            }
        }
        .navigationTitle("86")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
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
                    LaRiOSInlineBanner(message: err, tone: .bad)
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
            .frame(maxWidth: 1180, alignment: .leading)
            .padding(LaRiOS.Spacing.twelve)
        }
        .scrollContentBackground(.hidden)
        .background(LaRiOS.Colors.background)
        .searchable(text: $query, prompt: "Find an item")
    }

    private func filtered(_ rows: [EightySixRow]) -> [EightySixRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.item.localizedCaseInsensitiveContains(q) }
    }

    private func header(_ snap: EightySixBoardSnapshot) -> some View {
        LaRiOSBoardHeader(
            eyebrow: "Line",
            title: "86 board",
            subtitle: openLabel(snap.active.count)
        ) {
            LaRiOSChip(text: snap.active.isEmpty ? "All on" : "Needs callout", tone: snap.active.isEmpty ? .ok : .bad)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .lariosPanel(padding: LaRiOS.Spacing.eight, fill: LaRiOS.Colors.panelRaised)
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            LaRiOSSectionHeader(title: "Mark out", subtitle: "Keep the menu honest.", tone: .bad)
            TextField("Item", text: $item)
                .textFieldStyle(.plain)
                .lariosInputChrome()
            Picker("Station", selection: $stationId) {
                Text("Any station").tag("")
                ForEach(vm.stations, id: \.id) { station in
                    Text(station.name).tag(station.id)
                }
            }
            .tint(LaRiOS.Colors.accent)
            Picker("Reason", selection: $reason) {
                ForEach(EightySixReasonCode.allCases) { code in
                    Text(code.label).tag(code)
                }
            }
            .tint(LaRiOS.Colors.accent)
            TextField("Qty (optional)", text: $quantity)
                .textFieldStyle(.plain)
                .lariosInputChrome()
            Button(vm.isSaving ? "Saving…" : "86 now") {
                Task { await submitAdd() }
            }
            .buttonStyle(.larios(.primary))
            .disabled(vm.isSaving || item.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .frame(minHeight: 44)
        }
        .lariosPanel(fill: LaRiOS.Colors.panel)
    }

    private func cascadeSection(_ cascaded: [CascadedRecipe]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LaRiOSSectionHeader(title: "Also hits the menu", tone: .warn)
            ForEach(cascaded, id: \.slug) { recipe in
                if vm.confirmCascade?.slug == recipe.slug {
                    HStack {
                        Text(recipe.name)
                            .font(LaRiOS.Typography.bodyStrong)
                            .foregroundStyle(LaRiOS.Colors.text)
                        Spacer()
                        Button("Confirm") {
                            Task { await submitCascadeConfirm(recipe) }
                        }
                        .buttonStyle(.larios(.primary))
                        .accessibilityLabel("Confirm adding \(recipe.name)")
                        Button("Cancel") { vm.confirmCascade = nil }
                            .buttonStyle(.larios(.ghost))
                            .accessibilityLabel("Cancel adding \(recipe.name)")
                    }
                } else {
                    Button {
                        vm.confirmCascade = recipe
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(recipe.name)
                                    .font(LaRiOS.Typography.bodyStrong)
                                    .foregroundStyle(LaRiOS.Colors.text)
                                Text("via \(recipe.via)")
                                    .font(LaRiOS.Typography.xsmall)
                                    .foregroundStyle(LaRiOS.Colors.textMuted)
                            }
                            Spacer()
                            Image(systemName: "plus.circle")
                                .foregroundStyle(LaRiOS.Colors.accent)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(recipe.name), via \(recipe.via)")
                }
            }
        }
        .lariosPanel(fill: LaRiOS.Colors.metal.opacity(0.10), stroke: LaRiOS.Colors.metal.opacity(0.45))
    }

    private func activeSection(_ rows: [EightySixRow], totalCount: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LaRiOSSectionHeader(title: "Out now", subtitle: totalCount == 0 ? "Clear" : "\(totalCount) open", tone: totalCount == 0 ? .ok : .bad)
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
                            Text(row.item)
                                .font(LaRiOS.Typography.bodyStrong)
                                .foregroundStyle(LaRiOS.Colors.text)
                            if let meta = activeMeta(row) {
                                Text(meta)
                                    .font(LaRiOS.Typography.xsmall)
                                    .foregroundStyle(LaRiOS.Colors.textMuted)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        Spacer()
                        Button(vm.isResolving(row.id) ? "…" : "Back on menu") {
                            Task { await submitResolve(id: row.id) }
                        }
                        .buttonStyle(.larios(.secondary))
                        .disabled(vm.isResolving(row.id))
                        .accessibilityLabel("Put \(row.item) back on the menu")
                    }
                    .padding(LaRiOS.Spacing.five)
                    .background(LaRiOS.Colors.panelRaised, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
                    .overlay {
                        RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                            .stroke(LaRiOS.Colors.hairline, lineWidth: 1)
                    }
                }
            }
        }
        .lariosPanel(fill: LaRiOS.Colors.panel)
    }

    private func resolvedSection(_ rows: [EightySixRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LaRiOSSectionHeader(title: "Back on today", subtitle: "\(rows.count) done", tone: .ok)
            ForEach(rows) { row in
                HStack {
                    Text(row.item)
                        .font(LaRiOS.Typography.bodyStrong)
                        .foregroundStyle(LaRiOS.Colors.text)
                    Spacer()
                    if let meta = resolvedMeta(row) {
                        Text(meta)
                            .font(LaRiOS.Typography.xsmall)
                            .foregroundStyle(LaRiOS.Colors.textMuted)
                    }
                }
                .padding(LaRiOS.Spacing.five)
                .background(LaRiOS.Colors.panelRaised.opacity(0.72), in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
                .accessibilityElement(children: .combine)
            }
        }
        .lariosPanel(fill: LaRiOS.Colors.panel)
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
