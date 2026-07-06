import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Stage — native port of `app/shows/[id]/stage` (`StageBoard.jsx` +
/// GET/POST stage). One UPSERTed setup per (show, location): room config
/// from the six-entry house catalog, `{t,what,who}` run-of-show entries,
/// rider JSON blobs, notes. Operational write — file-stream audit in-tx.
/// PIN-gated whole-board.
struct ShowStageView: View {
    @State private var gateModel: ShowsGateModel
    @State private var picker: ShowPickerModel
    @State private var vm: ShowStageViewModel

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        let gate = ShowsGateModel(database: database, writeDatabase: writeDatabase)
        _gateModel = State(wrappedValue: gate)
        _picker = State(wrappedValue: ShowPickerModel(database: database))
        _vm = State(wrappedValue: ShowStageViewModel(
            readDB: database, writeDB: writeDatabase, gateModel: gate
        ))
    }

    var body: some View {
        ShowsGatedBoard(gateModel: gateModel, title: "Stage") {
            content
                .task {
                    await picker.load()
                    vm.start(picker: picker)
                }
                .onDisappear { vm.stop() }
        }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            List {
                Section { ShowPickerRow(model: picker) }
                if let loadError = vm.loadError {
                    // Separate channel from submitError: a failed LOAD means
                    // the form may not reflect this show — saving could
                    // overwrite the real setup, so Save is disabled below.
                    Section {
                        Label(loadError, systemImage: "exclamationmark.triangle")
                            .font(.callout)
                            .foregroundStyle(LariatTheme.bad)
                    }
                }
                roomSection
                runOfShowSection
                ridersSection
                completenessSection
                if let submitError = vm.submitError {
                    Section { Text(submitError).font(.callout).foregroundStyle(LariatTheme.bad) }
                }
            }
            HStack {
                if vm.dirty {
                    Text("Unsaved changes").font(.caption).foregroundStyle(LariatTheme.warn)
                }
                Spacer()
                Button("Save stage setup") { vm.save() }
                    .disabled(picker.selectedShow == nil || vm.roomConfig.isEmpty
                              || vm.loadError != nil)
                    .buttonStyle(.borderedProminent)
                    .padding()
            }
        }
    }

    @ViewBuilder
    private var roomSection: some View {
        Section("Room configuration") {
            Picker("Room config", selection: $vm.roomConfig) {
                Text("— pick —").tag("")
                ForEach(StageRoomCatalog.knownRoomConfigs) { config in
                    Text(config.name).tag(config.key)
                }
            }
            .pickerStyle(.menu)
            if let config = StageRoomCatalog.config(for: vm.roomConfig) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(config.description).font(.callout)
                    Text(config.layout).font(.caption).foregroundStyle(.secondary)
                    Text("Cap \(config.capacity) · changeover \(config.changeoverStaff) staff / \(config.changeoverMinutes) min · \(config.bestFor)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private var runOfShowSection: some View {
        Section("Run of show") {
            if vm.runOfShow.isEmpty {
                EmptyState(message: "No run-of-show entries yet.", systemImage: "list.number")
            }
            // Identity-based ForEach + delete-by-id: index bindings with
            // remove(at:) fatal-error when a later row's TextField holds
            // focus while an earlier row is deleted (stale $vm.runOfShow[i]).
            ForEach($vm.runOfShow) { $entry in
                HStack {
                    TextField("Time", text: $entry.t).frame(width: 90)
                    TextField("What", text: $entry.what)
                    TextField("Who", text: $entry.who)
                    Button(role: .destructive) {
                        vm.runOfShow.removeAll { $0.id == entry.id }
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(runOfShowDeleteLabel(for: entry))
                }
                .font(.callout)
            }
            Button("Add entry") {
                vm.runOfShow.append(ShowStageViewModel.RunEntryDraft())
            }
        }
    }

    /// Per-row delete label so VoiceOver can distinguish otherwise-identical
    /// trash buttons — falls back to a generic label when the row is blank.
    private func runOfShowDeleteLabel(for entry: ShowStageViewModel.RunEntryDraft) -> String {
        if !entry.what.isEmpty { return "Remove run-of-show entry: \(entry.what)" }
        if !entry.t.isEmpty { return "Remove run-of-show entry at \(entry.t)" }
        return "Remove run-of-show entry"
    }

    @ViewBuilder
    private var ridersSection: some View {
        Section("Hospitality rider (JSON)") {
            TextEditor(text: $vm.hospitalityJson)
                .font(.system(.caption, design: .monospaced))
                .frame(minHeight: 70)
                .accessibilityLabel("Hospitality rider JSON")
        }
        Section("Tech rider (JSON)") {
            TextEditor(text: $vm.techJson)
                .font(.system(.caption, design: .monospaced))
                .frame(minHeight: 70)
                .accessibilityLabel("Tech rider JSON")
        }
        Section("Notes") {
            TextField("Manager notes", text: $vm.notes, axis: .vertical)
        }
    }

    @ViewBuilder
    private var completenessSection: some View {
        Section("Completeness") {
            let c = vm.completeness
            HStack(spacing: 14) {
                flag("Room", c.hasRoomConfig)
                flag("Run of show", c.hasRunOfShow)
                flag("Hospitality", c.hasHospitalityRider)
                flag("Tech", c.hasTechRider)
                Spacer()
                Text("\(Int((c.score * 100).rounded()))%")
                    .font(.headline).monospacedDigit()
                    .foregroundStyle(c.score >= 1 ? LariatTheme.ok : LariatTheme.warn)
            }
        }
    }

    @ViewBuilder
    private func flag(_ label: String, _ on: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(on ? LariatTheme.ok : LariatTheme.muted)
            Text(label).font(.caption)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(on ? "complete" : "incomplete")")
    }
}

/// Stage view model — loads the setup for the selected show; save UPSERTs.
@Observable @MainActor
final class ShowStageViewModel {
    /// Identifiable editing wrapper around `RunOfShowEntry` (the Settlement
    /// `CostDraft` pattern) so the view can bind rows by identity.
    struct RunEntryDraft: Identifiable, Equatable {
        let id = UUID()
        var t = ""
        var what = ""
        var who = ""
    }

    var roomConfig = "" {
        didSet { if oldValue != roomConfig { markDirty() } }
    }
    var runOfShow: [RunEntryDraft] = [] {
        didSet { if oldValue != runOfShow { markDirty() } }
    }
    var hospitalityJson = "{}" {
        didSet { if oldValue != hospitalityJson { markDirty() } }
    }
    var techJson = "{}" {
        didSet { if oldValue != techJson { markDirty() } }
    }
    var notes = "" {
        didSet { if oldValue != notes { markDirty() } }
    }
    var dirty = false
    var submitError: String?
    /// Load failures render in their own section (NOT `submitError`) and
    /// disable Save — a stale form must not overwrite the show's real setup.
    var loadError: String?

    /// True while the form is being (re)populated from a fetch/save result,
    /// so adoption doesn't count as an operator edit.
    private var isAdopting = false
    private var loadedShowId: Int64?
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

    var completeness: StageCompleteness {
        StageCompleteness.from(setup: StageSetupRow(
            id: 0, showId: loadedShowId ?? 0, locationId: locationId,
            roomConfig: roomConfig, runOfShow: runEntries,
            hospitalityRiderJson: hospitalityJson, techRiderJson: techJson,
            notes: notes.isEmpty ? nil : notes, createdAt: "", updatedAt: ""
        ))
    }

    /// The drafts as persistence-shaped `{t, what, who}` entries.
    private var runEntries: [RunOfShowEntry] {
        runOfShow.map { RunOfShowEntry(t: $0.t, what: $0.what, who: $0.who) }
    }

    private static func drafts(from entries: [RunOfShowEntry]) -> [RunEntryDraft] {
        entries.map { RunEntryDraft(t: $0.t, what: $0.what, who: $0.who) }
    }

    private func markDirty() {
        if !isAdopting { dirty = true }
    }

    func start(picker: ShowPickerModel) {
        self.picker = picker
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.loadIfShowChanged()
            // Load failures live in their own channel now — feed the backoff.
            try BoardPoller.throwIfFailed(self.loadError)
        }
    }

    func stop() { poller.stop() }

    /// Reload the form ONLY when the selected show changes (not every poll
    /// tick) so in-progress edits survive — the web board is also
    /// client-state-first between saves.
    func loadIfShowChanged() async {
        guard let showId = picker?.selectedShowId, showId != loadedShowId else { return }
        let repo = StageRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
        do {
            let setup = try await repo.getSetup(showId: showId)
            // Commit loadedShowId only AFTER a successful fetch — a failed
            // load must keep retrying on the next poll tick.
            loadedShowId = showId
            loadError = nil
            submitError = nil
            isAdopting = true
            defer { isAdopting = false }
            if let setup {
                roomConfig = setup.roomConfig
                runOfShow = Self.drafts(from: setup.runOfShow)
                hospitalityJson = setup.hospitalityRiderJson
                techJson = setup.techRiderJson
                notes = setup.notes ?? ""
            } else {
                roomConfig = ""
                runOfShow = []
                hospitalityJson = "{}"
                techJson = "{}"
                notes = ""
            }
            dirty = false
        } catch {
            loadedShowId = nil   // poller retries on the next tick
            loadError = "Could not load the stage setup — retrying. Saving is disabled so a stale form can't overwrite it."
        }
    }

    func save() {
        submitError = nil
        guard loadError == nil else { return }
        guard let showId = picker?.selectedShowId else { return }
        do {
            let user = try gateModel.actorForWrite()
            let repo = StageRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
            let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = try repo.upsertSetup(.init(
                showId: showId,
                roomConfig: roomConfig,
                runOfShow: runEntries.filter { !($0.t.isEmpty && $0.what.isEmpty && $0.who.isEmpty) },
                hospitalityRiderJson: hospitalityJson,
                techRiderJson: techJson,
                notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
                actorCookId: user.map { String($0.id) }
            ))
            // Re-adopt the persisted row (normalized riders etc.).
            isAdopting = true
            defer { isAdopting = false }
            roomConfig = result.setup.roomConfig
            runOfShow = Self.drafts(from: result.setup.runOfShow)
            hospitalityJson = result.setup.hospitalityRiderJson
            techJson = result.setup.techRiderJson
            notes = result.setup.notes ?? ""
            dirty = false
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }
}
