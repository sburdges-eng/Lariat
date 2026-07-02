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
                    .disabled(picker.selectedShow == nil || vm.roomConfig.isEmpty)
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
            }
        }
    }

    @ViewBuilder
    private var runOfShowSection: some View {
        Section("Run of show") {
            if vm.runOfShow.isEmpty {
                EmptyState(message: "No run-of-show entries yet.", systemImage: "list.number")
            }
            ForEach(vm.runOfShow.indices, id: \.self) { i in
                HStack {
                    TextField("Time", text: $vm.runOfShow[i].t).frame(width: 90)
                    TextField("What", text: $vm.runOfShow[i].what)
                    TextField("Who", text: $vm.runOfShow[i].who)
                    Button(role: .destructive) { vm.runOfShow.remove(at: i) } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                }
                .font(.callout)
            }
            Button("Add entry") {
                vm.runOfShow.append(RunOfShowEntry(t: "", what: "", who: ""))
            }
        }
    }

    @ViewBuilder
    private var ridersSection: some View {
        Section("Hospitality rider (JSON)") {
            TextEditor(text: $vm.hospitalityJson)
                .font(.system(.caption, design: .monospaced))
                .frame(minHeight: 70)
        }
        Section("Tech rider (JSON)") {
            TextEditor(text: $vm.techJson)
                .font(.system(.caption, design: .monospaced))
                .frame(minHeight: 70)
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
    }
}

/// Stage view model — loads the setup for the selected show; save UPSERTs.
@Observable @MainActor
final class ShowStageViewModel {
    var roomConfig = ""
    var runOfShow: [RunOfShowEntry] = []
    var hospitalityJson = "{}"
    var techJson = "{}"
    var notes = ""
    var dirty = false
    var submitError: String?

    private var loadedShowId: Int64?
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let gateModel: ShowsGateModel
    private let locationId: String
    private var pollTask: Task<Void, Never>?
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
            roomConfig: roomConfig, runOfShow: runOfShow,
            hospitalityRiderJson: hospitalityJson, techRiderJson: techJson,
            notes: notes.isEmpty ? nil : notes, createdAt: "", updatedAt: ""
        ))
    }

    func start(picker: ShowPickerModel) {
        self.picker = picker
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.loadIfShowChanged()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() { pollTask?.cancel() }

    /// Reload the form ONLY when the selected show changes (not every poll
    /// tick) so in-progress edits survive — the web board is also
    /// client-state-first between saves.
    func loadIfShowChanged() async {
        guard let showId = picker?.selectedShowId, showId != loadedShowId else { return }
        loadedShowId = showId
        dirty = false
        submitError = nil
        let repo = StageRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
        do {
            if let setup = try await repo.getSetup(showId: showId) {
                roomConfig = setup.roomConfig
                runOfShow = setup.runOfShow
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
        } catch {
            submitError = "Could not load the stage setup"
        }
    }

    func save() {
        submitError = nil
        guard let showId = picker?.selectedShowId else { return }
        do {
            let user = try gateModel.actorForWrite()
            let repo = StageRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
            let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = try repo.upsertSetup(.init(
                showId: showId,
                roomConfig: roomConfig,
                runOfShow: runOfShow.filter { !($0.t.isEmpty && $0.what.isEmpty && $0.who.isEmpty) },
                hospitalityRiderJson: hospitalityJson,
                techRiderJson: techJson,
                notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
                actorCookId: user.map { String($0.id) }
            ))
            // Re-adopt the persisted row (normalized riders etc.).
            roomConfig = result.setup.roomConfig
            runOfShow = result.setup.runOfShow
            hospitalityJson = result.setup.hospitalityRiderJson
            techJson = result.setup.techRiderJson
            notes = result.setup.notes ?? ""
            dirty = false
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }
}
