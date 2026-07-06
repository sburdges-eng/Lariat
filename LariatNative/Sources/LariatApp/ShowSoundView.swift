import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Sound — native port of `app/shows/[id]/sound` (`SoundBoard.jsx` +
/// GET/POST sound + PATCH/DELETE scene + GET/POST sound/spl). Scenes are
/// saved snapshots; SPL readings are an append-only telemetry series with
/// the 30–160 dB gate and 90/100% threshold bands. Operational writes audit
/// via the file stream inside the write tx. PIN-gated whole-board.
struct ShowSoundView: View {
    @State private var gateModel: ShowsGateModel
    @State private var picker: ShowPickerModel
    @State private var vm: ShowSoundViewModel

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        let gate = ShowsGateModel(database: database, writeDatabase: writeDatabase)
        _gateModel = State(wrappedValue: gate)
        _picker = State(wrappedValue: ShowPickerModel(database: database))
        _vm = State(wrappedValue: ShowSoundViewModel(
            readDB: database, writeDB: writeDatabase, gateModel: gate
        ))
    }

    var body: some View {
        ShowsGatedBoard(gateModel: gateModel, title: "Sound") {
            content
                .task {
                    await picker.load()
                    vm.start(picker: picker)
                }
                .onDisappear { vm.stop() }
                .sheet(isPresented: $vm.showSceneForm) { sceneForm }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = vm.fetchError, vm.scenes.isEmpty && vm.readings.isEmpty {
            TileDegrade(title: "Could not load sound board", message: err, systemImage: "speaker.wave.3")
        } else {
            List {
                Section { ShowPickerRow(model: picker) }
                if let submitError = vm.submitError {
                    Section { Text(submitError).font(.callout).foregroundStyle(LariatTheme.bad) }
                }
                splSection
                scenesSection
            }
        }
    }

    // ── SPL telemetry ─────────────────────────────────────────────────

    @ViewBuilder
    private var splSection: some View {
        Section("SPL") {
            let summary = vm.splSummary
            let latestStatus = SplTelemetryCompute.splThresholdStatus(summary.latest, limit: summary.limitDb)
            HStack {
                kpi(summary.latest.map { db($0) } ?? "—", "latest",
                    color: statusColor(latestStatus), status: latestStatus)
                kpi(summary.peak.map { db($0) } ?? "—", "peak")
                kpi(summary.avgLastN.map { db($0) } ?? "—", "avg")
                kpi("\(summary.overLimitCount)", "over limit",
                    color: summary.overLimitCount > 0 ? LariatTheme.bad : LariatTheme.ok)
                kpi(summary.limitDb.map { db($0) } ?? "—", "limit")
            }
            sparkline
            HStack {
                TextField("dB (30–160)", text: $vm.splText)
                    .frame(maxWidth: 140)
                Button("Log reading") { vm.appendReading() }
                    .disabled(vm.splText.trimmingCharacters(in: .whitespaces).isEmpty
                              || picker.selectedShow == nil)
            }
            if vm.readings.isEmpty {
                EmptyState(message: "No SPL readings yet.", systemImage: "waveform")
            }
        }
    }

    @ViewBuilder
    private var sparkline: some View {
        let result = SplTelemetryCompute.sparklinePath(
            vm.readings, limit: vm.splSummary.limitDb,
            opts: SparklineOpts(width: 320, height: 48, padding: 2)
        )
        if !result.d.isEmpty {
            ZStack {
                if let points = Self.pathPoints(result.d) {
                    Path { p in
                        guard let first = points.first else { return }
                        p.move(to: first)
                        for pt in points.dropFirst() { p.addLine(to: pt) }
                    }
                    .stroke(LariatTheme.amber, lineWidth: 1.5)
                }
                if let ty = result.thresholdY {
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: ty))
                        p.addLine(to: CGPoint(x: result.width, y: ty))
                    }
                    .stroke(LariatTheme.bad.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                }
            }
            .frame(width: result.width, height: result.height)
            .accessibilityLabel("SPL sparkline")
        }
    }

    /// Parse the compute's SVG `d` ("Mx,yLx,y…") into CGPoints — the native
    /// renderer for the SAME path math the web draws.
    static func pathPoints(_ d: String) -> [CGPoint]? {
        let segments = d.split(whereSeparator: { $0 == "M" || $0 == "L" })
        let points = segments.compactMap { seg -> CGPoint? in
            let parts = seg.split(separator: ",")
            guard parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) else { return nil }
            return CGPoint(x: x, y: y)
        }
        return points.isEmpty ? nil : points
    }

    // ── Scenes ────────────────────────────────────────────────────────

    @ViewBuilder
    private var scenesSection: some View {
        Section {
            if vm.scenes.isEmpty {
                EmptyState(message: "No saved scenes yet.", systemImage: "slider.horizontal.3")
            } else {
                ForEach(vm.scenes) { scene in
                    HStack {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(scene.sceneName).font(.callout)
                                Text("\(scene.plot.channels.count) ch · \(scene.plot.monitors.count) mon · \(scene.savedAt)")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let limit = scene.splLimitDb {
                                Text("limit \(db(limit))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)

                        Button(role: .destructive) { vm.deleteScene(scene) } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Delete scene \(scene.sceneName)")
                    }
                }
            }
            Button("Save new scene") { vm.showSceneForm = true }
                .disabled(picker.selectedShow == nil)
        } header: {
            Text("Scenes (\(vm.scenes.count))")
        }
    }

    @ViewBuilder
    private var sceneForm: some View {
        NavigationStack {
            Form {
                TextField("Scene name (e.g. soundcheck, set 1)", text: $vm.sceneName)
                TextField("SPL limit dB (optional)", text: $vm.sceneSplLimit)
                TextField("Notes (optional)", text: $vm.sceneNotes)
                if let submitError = vm.submitError {
                    Text(submitError).font(.caption).foregroundStyle(LariatTheme.bad)
                }
            }
            .navigationTitle("Save scene")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showSceneForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { vm.createScene() }
                        .disabled(vm.sceneName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .frame(minWidth: 380, minHeight: 280)
    }

    // ── helpers ───────────────────────────────────────────────────────

    @ViewBuilder
    private func kpi(_ value: String, _ label: String, color: Color = .primary, status: SplStatus? = nil) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline).monospacedDigit().foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(kpiAccessibilityLabel(value: value, label: label, status: status))
    }

    /// Verbalizes the tile's value+label in "label: value" order (default
    /// combine reads "value, label" backwards), plus the one status this
    /// board's "latest" tile conveys by color alone: amber (90–100% of the
    /// configured limit) and red (over limit) are genuinely ambiguous without
    /// sight — green/unset already read unambiguously via the value itself
    /// ("—" for unset; a plain dB number for green), and "over limit"'s own
    /// count+label needs no extra word.
    private func kpiAccessibilityLabel(value: String, label: String, status: SplStatus?) -> String {
        var text = "\(label): \(value)"
        switch status {
        case .amber: text += ", near limit"
        case .red: text += ", over limit"
        case .green, .unset, .none: break
        }
        return text
    }

    private func statusColor(_ status: SplStatus) -> Color {
        switch status {
        case .green: return LariatTheme.ok
        case .amber: return LariatTheme.warn
        case .red: return LariatTheme.bad
        case .unset: return LariatTheme.muted
        }
    }

    private func db(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n)
    }
}

/// Sound view model — polls scenes + readings every 5 s.
@Observable @MainActor
final class ShowSoundViewModel {
    var scenes: [SoundSceneRow] = []
    var readings: [SplReadingRow] = []
    var fetchError: String?
    var submitError: String?
    var showSceneForm = false
    var splText = ""
    var sceneName = ""
    var sceneSplLimit = ""
    var sceneNotes = ""

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let gateModel: ShowsGateModel
    private let locationId: String
    private let poller = BoardPoller()
    private weak var picker: ShowPickerModel?

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase?,
        gateModel: ShowsGateModel,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.gateModel = gateModel
        self.locationId = locationId
    }

    var splSummary: SplSummary {
        SplTelemetryCompute.summarizeSpl(readings, limit: scenes.first?.splLimitDb)
    }

    func start(picker: ShowPickerModel) {
        self.picker = picker
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        guard let showId = picker?.selectedShowId else {
            scenes = []
            readings = []
            return
        }
        let repo = repo()
        do {
            scenes = try await repo.listScenes(showId: showId)
            readings = try await repo.listSplReadings(showId: showId, limit: 200)
            fetchError = nil
        } catch {
            fetchError = "Could not load sound board"
        }
    }

    func createScene() {
        submitError = nil
        guard let showId = picker?.selectedShowId else { return }
        // An unparseable SPL limit must keep the sheet open with an error —
        // silently saving a scene WITHOUT a limit disarms the over-limit
        // alarms while the engineer believes one is set.
        var limit: Double?
        let limitText = sceneSplLimit.trimmingCharacters(in: .whitespaces)
        if !limitText.isEmpty {
            guard let parsed = Double(limitText) else {
                submitError = "SPL limit must be a number (30–160)"
                return
            }
            limit = parsed
        }
        do {
            _ = try gateModel.actorForWrite()
        } catch {
            // actorForWrite presented the PIN sheet, which can't show over
            // the scene-form sheet on macOS (PR #401). Dismiss the form,
            // stash the save, replay after a verify — and report a cancelled
            // PIN instead of silently dropping the scene.
            showSceneForm = false
            gateModel.stashPendingWrite(
                retry: { [weak self] in self?.createScene() },
                onCancel: { [weak self] in
                    self?.submitError = "PIN required — scene not saved. Reopen “Save new scene” to try again."
                }
            )
            return
        }
        do {
            let notes = sceneNotes.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try repo().createScene(.init(
                showId: showId,
                sceneName: sceneName,
                plot: scenes.first?.plot ?? .empty,   // carry the latest plot forward
                splLimitDb: limit,
                notes: notes.isEmpty ? nil : notes,
                savedByCookId: gateModel.pinStore.activeUser.map { String($0.id) }
            ))
            sceneName = ""
            sceneSplLimit = ""
            sceneNotes = ""
            showSceneForm = false
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    func deleteScene(_ scene: SoundSceneRow) {
        submitError = nil
        do {
            _ = try gateModel.actorForWrite()
            _ = try repo().deleteScene(id: scene.id)
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    func appendReading() {
        submitError = nil
        guard let showId = picker?.selectedShowId else { return }
        guard let value = Double(splText.trimmingCharacters(in: .whitespaces)) else {
            submitError = "db_value must be a finite number in [30, 160]"
            return
        }
        do {
            _ = try gateModel.actorForWrite()
            _ = try repo().appendSplReading(.init(
                showId: showId,
                sceneId: scenes.first?.id,
                dbValue: value,
                takenByCookId: gateModel.pinStore.activeUser.map { String($0.id) }
            ))
            splText = ""
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    private func repo() -> SoundRepository {
        SoundRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
    }
}
