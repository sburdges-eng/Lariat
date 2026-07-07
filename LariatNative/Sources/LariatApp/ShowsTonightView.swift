import SwiftUI
import LariatDB
import LariatModel

/// Tonight · Live — native port of `app/shows/tonight` (single-pane live
/// show view): tonight's show, attendance vs effective capacity, box-office
/// rollup, run of show, stage/sound context, previous-show strip, capacity
/// override, and the 5-week pipeline strip. PIN-gated whole-board (web
/// SENSITIVE_PREFIXES parity).
struct ShowsTonightView: View {
    @State private var gateModel: ShowsGateModel
    @State private var vm: ShowsTonightViewModel

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        let gate = ShowsGateModel(database: database, writeDatabase: writeDatabase)
        _gateModel = State(wrappedValue: gate)
        _vm = State(wrappedValue: ShowsTonightViewModel(
            readDB: database, writeDB: writeDatabase, gateModel: gate
        ))
    }

    var body: some View {
        ShowsGatedBoard(gateModel: gateModel, title: "Tonight · Live") {
            content
                .task { vm.start() }
                .tracksActiveBoard(vm.poller)
                .onDisappear { vm.stop() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = vm.fetchError, vm.snapshot == nil {
            TileDegrade(title: "Could not load tonight", message: err, systemImage: "music.mic")
        } else if let snap = vm.snapshot {
            List {
                headline(snap)
                attendanceSection(snap)
                boxOfficeSection(snap)
                runOfShowSection(snap)
                stageSoundSection(snap)
                capacitySection(snap)
                pipelineSection
            }
        } else {
            ProgressView("Loading tonight…")
        }
    }

    // ── Sections ──────────────────────────────────────────────────────

    @ViewBuilder
    private func headline(_ snap: ShowsRepository.TonightSnapshot) -> some View {
        Section {
            if let show = snap.show {
                VStack(alignment: .leading, spacing: 4) {
                    Text(show.bandName).font(.title2).bold()
                    HStack(spacing: 12) {
                        Text(show.showDate)
                        if let price = show.price {
                            Text(String(format: "$%.2f", price))
                        }
                        if let doors = vm.doorsLabel() {
                            Text("Doors \(doors)")
                        }
                    }
                    .font(.callout).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            } else {
                EmptyState(message: "No show tonight (\(snap.date)).", systemImage: "moon.zzz")
            }
            if let prev = snap.previousShow {
                HStack {
                    Text("Last show").foregroundStyle(.secondary)
                    Spacer()
                    Text("\(prev.bandName) · \(prev.showDate)")
                }
                .font(.caption)
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private func attendanceSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
        if let a = snap.attendance {
            Section("Attendance") {
                HStack(spacing: 16) {
                    VStack(alignment: .leading) {
                        Text("\(a.scannedQty)").font(.title).monospacedDigit()
                            .foregroundStyle(attendanceColor(a.status))
                        Text("scanned in").font(.caption2).foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading) {
                        Text("\(a.soldQty)").font(.title).monospacedDigit()
                        Text("sold").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let cap = a.capacity, let pct = a.scannedPct {
                        VStack(alignment: .trailing) {
                            Text("\(fmtPct(pct))% of \(cap)")
                                .font(.headline).monospacedDigit()
                                .foregroundStyle(attendanceColor(a.status))
                            Text(a.status.rawValue).font(.caption2).foregroundStyle(.secondary)
                        }
                    } else {
                        Text("capacity unset").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private func boxOfficeSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
        if let s = snap.boxOfficeSummary {
            Section("Box office") {
                HStack {
                    kpi("\(s.totalQty)", "tickets")
                    kpi(money(s.totalFaceValue), "face value")
                    kpi(money(s.totalFees), "fees")
                    kpi(money(s.totalRevenue), "revenue")
                }
                ForEach(BoxOfficeSource.allCases, id: \.rawValue) { src in
                    if let bucket = s.bySource[src], bucket.qty > 0 {
                        HStack {
                            Text(SettlementPrintCompute.sourceLabel(src.rawValue))
                            Spacer()
                            Text("\(bucket.qty) · \(money(bucket.revenue))").monospacedDigit()
                        }
                        .font(.callout)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func runOfShowSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
        if snap.show != nil {
            Section("Run of show") {
                if snap.runOfShow.isEmpty {
                    EmptyState(message: "No run-of-show entries yet.", systemImage: "list.bullet")
                } else {
                    ForEach(Array(snap.runOfShow.enumerated()), id: \.offset) { _, entry in
                        HStack {
                            Text(entry.time ?? "—").foregroundStyle(.secondary)
                                .frame(minWidth: 90, alignment: .leading)
                            Text(entry.label)
                        }
                        .font(.callout)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func stageSoundSection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
        if snap.show != nil {
            Section("Stage · Sound") {
                HStack {
                    Text("Room config").foregroundStyle(.secondary)
                    Spacer()
                    Text(snap.stageSetup.flatMap { StageRoomCatalog.config(for: $0.roomConfig)?.name }
                         ?? snap.stageSetup?.roomConfig ?? "—")
                }
                .accessibilityElement(children: .combine)
                HStack {
                    Text("Latest scene").foregroundStyle(.secondary)
                    Spacer()
                    if let scene = snap.latestSoundScene {
                        Text(scene.splLimitDb.map { "\(scene.sceneName) · limit \(fmtPct($0)) dB" }
                             ?? scene.sceneName)
                    } else {
                        Text("—")
                    }
                }
                .accessibilityElement(children: .combine)
            }
            .font(.callout)
        }
    }

    @ViewBuilder
    private func capacitySection(_ snap: ShowsRepository.TonightSnapshot) -> some View {
        if snap.show != nil {
            Section("Capacity override") {
                HStack {
                    Text("Venue \(snap.venueCapacity.map(String.init) ?? "—") · override \(snap.capacityOverride.map(String.init) ?? "—") · effective \(snap.effectiveCapacity.map(String.init) ?? "—")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                HStack {
                    TextField("Capacity (≤ 5000)", text: $vm.capacityText)
                        .frame(maxWidth: 160)
                    Button("Set") { vm.setCapacity() }
                        .disabled(vm.capacityText.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Clear") { vm.clearCapacity() }
                }
                if let err = vm.capacityError {
                    Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
                }
            }
        }
    }

    @ViewBuilder
    private var pipelineSection: some View {
        Section("Upcoming · 5 weeks") {
            HStack(spacing: 10) {
                ForEach(PipelineStage.allCases, id: \.rawValue) { stage in
                    VStack(spacing: 2) {
                        Text("\(vm.pipelineCounts[stage] ?? 0)").font(.headline).monospacedDigit()
                        Text(stage.rawValue).font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(stage.rawValue): \(vm.pipelineCounts[stage] ?? 0)")
                }
            }
            if vm.upcoming.isEmpty {
                EmptyState(message: "No upcoming shows in the window.", systemImage: "calendar")
            } else {
                ForEach(vm.upcoming) { show in
                    HStack {
                        Text(show.showDate).foregroundStyle(.secondary)
                            .frame(minWidth: 100, alignment: .leading)
                        Text(show.bandName)
                        Spacer()
                        Text(vm.stage(for: show).rawValue)
                            .font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Capsule().fill(Color.secondary.opacity(0.15)))
                    }
                    .font(.callout)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    // ── helpers ───────────────────────────────────────────────────────

    @ViewBuilder
    private func kpi(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    private func attendanceColor(_ status: AttendanceStatus) -> Color {
        switch status {
        case .unset: return LariatTheme.muted
        case .under: return LariatTheme.muted
        case .near: return LariatTheme.warn
        case .at: return LariatTheme.ok
        case .over: return LariatTheme.bad
        }
    }

    private func money(_ dollars: Double) -> String {
        String(format: "$%.2f", dollars)
    }

    private func fmtPct(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(n)
    }
}
