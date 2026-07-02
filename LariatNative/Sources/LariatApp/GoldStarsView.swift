import SwiftUI
import LariatDB
import LariatModel

/// Native port of `/gold-stars` — the recognition wall. The board resets
/// each day (yesterday's stars leave the feed, never deleted); the
/// leaderboard is the permanent all-time per-employee record. Awarding and
/// removing stars are PIN-gated manager actions.
struct GoldStarsView: View {
    @State private var vm: GoldStarsViewModel
    @State private var removeTarget: GoldStarRow?

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: GoldStarsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.recognitions.isEmpty, vm.leaderboard.isEmpty {
                TileDegrade(title: "Could not load gold stars", message: err, systemImage: "star")
            } else if !vm.loaded {
                ProgressView("Loading gold stars…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("★ Gold Stars")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .toolbar {
            ToolbarItem {
                Button("Give a star") { vm.openAwardSheet() }
            }
        }
        .sheet(isPresented: $vm.showAwardSheet) { awardSheet }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
        .confirmationDialog(
            "Remove this Gold Star for \(removeTarget?.cookName ?? "")?",
            isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let target = removeTarget { vm.requestRemove(target) }
                removeTarget = nil
            }
            Button("Cancel", role: .cancel) { removeTarget = nil }
        }
    }

    @ViewBuilder
    private var content: some View {
        List {
            Section {
                Picker("View", selection: $vm.viewMode) {
                    ForEach(GoldStarsViewModel.ViewMode.allCases, id: \.self) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                if let e = vm.errorMessage {
                    Text(e).font(.callout).foregroundStyle(LariatTheme.bad)
                }
            }
            switch vm.viewMode {
            case .recent: recentSection
            case .leaderboard: leaderboardSection
            }
        }
        .searchable(text: $vm.searchText, prompt: "Search cooks")
    }

    @ViewBuilder
    private var recentSection: some View {
        Section {
            if vm.recognitions.isEmpty {
                EmptyState(
                    message: "No stars yet today. The board resets each day — all-time totals live on the leaderboard.",
                    systemImage: "star"
                )
            } else {
                ForEach(vm.visibleRecognitions) { record in
                    recognitionRow(record)
                }
            }
        }
    }

    @ViewBuilder
    private func recognitionRow(_ record: GoldStarRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(record.cookName).font(.callout.weight(.semibold))
                Text(record.reason).font(.caption)
                Text("Awarded: \(awardedDate(record.awardedDate))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(String(repeating: "★", count: max(record.stars, 1)))
                    .foregroundStyle(LariatTheme.amber)
                Button("Remove", role: .destructive) { removeTarget = record }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .disabled(vm.isSaving)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var leaderboardSection: some View {
        Section {
            if vm.leaderboard.isEmpty {
                EmptyState(message: "No stars awarded yet.", systemImage: "star")
            } else {
                ForEach(Array(vm.visibleLeaderboard.enumerated()), id: \.element.id) { index, cook in
                    HStack {
                        Text("#\(index + 1)")
                            .font(.caption.bold())
                            .foregroundStyle(index < 3 ? LariatTheme.amber : Color.secondary)
                            .frame(width: 34, alignment: .leading)
                        Text(cook.cookName).font(.callout)
                        Spacer()
                        Text("\(cook.totalStars) ★")
                            .font(.callout.bold())
                            .foregroundStyle(LariatTheme.amber)
                    }
                }
            }
        }
    }

    // ── award sheet (the web modal) ─────────────────────────────────────

    @ViewBuilder
    private var awardSheet: some View {
        NavigationStack {
            Form {
                if let e = vm.errorMessage {
                    Text(e).font(.caption).foregroundStyle(LariatTheme.bad)
                }
                Picker("Who", selection: $vm.selectedCook) {
                    Text("Pick a cook…").tag("")
                    ForEach(vm.roster, id: \.self) { name in
                        Text(name).tag(name)
                    }
                }
                Section("How big a deal") {
                    ForEach(GoldStarTier.allCases, id: \.rawValue) { tier in
                        Button {
                            vm.starCount = tier.rawValue
                        } label: {
                            HStack {
                                Text(tier.label)
                                Spacer()
                                if vm.starCount == tier.rawValue {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Section("What they did") {
                    TextField(
                        "e.g., Handled the grill solo during the dinner rush without dropping a single ticket.",
                        text: $vm.reason,
                        axis: .vertical
                    )
                    .lineLimit(3...6)
                }
            }
            .navigationTitle("Give a Gold Star")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Go back") { vm.showAwardSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(vm.isSaving ? "Saving…" : "Give it") { vm.requestAward() }
                        .disabled(
                            vm.isSaving || vm.selectedCook.isEmpty
                                || vm.reason.trimmingCharacters(in: .whitespaces).isEmpty
                        )
                }
            }
        }
        .frame(minWidth: 380, minHeight: 420)
    }

    /// `formatAwardedDate` parity: 'MMMM d, yyyy' from YYYY-MM-DD;
    /// unparseable values echo through.
    private func awardedDate(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "" }
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let date = fmt.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US")
        out.dateFormat = "MMMM d, yyyy"
        return out.string(from: date)
    }
}
