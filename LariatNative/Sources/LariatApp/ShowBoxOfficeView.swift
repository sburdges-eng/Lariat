import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Box office — native port of `app/shows/[id]/box-office`
/// (`BoxOfficeBoard.jsx` + GET/POST box-office + PATCH mark_scanned).
/// Regulated cash custody: line create + door scan post to the
/// `audit_events` DB stream in the same transaction. PIN-gated whole-board.
struct ShowBoxOfficeView: View {
    @State private var gateModel: ShowsGateModel
    @State private var picker: ShowPickerModel
    @State private var vm: ShowBoxOfficeViewModel

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        let gate = ShowsGateModel(database: database, writeDatabase: writeDatabase)
        _gateModel = State(wrappedValue: gate)
        _picker = State(wrappedValue: ShowPickerModel(database: database))
        _vm = State(wrappedValue: ShowBoxOfficeViewModel(
            readDB: database, writeDB: writeDatabase, gateModel: gate
        ))
    }

    var body: some View {
        ShowsGatedBoard(gateModel: gateModel, title: "Box office") {
            content
                .task {
                    await picker.load()
                    vm.start(picker: picker)
                }
                .onDisappear { vm.stop() }
                .sheet(isPresented: $vm.showForm) { addForm }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = vm.fetchError, vm.lines.isEmpty {
            TileDegrade(title: "Could not load box office", message: err, systemImage: "ticket")
        } else {
            VStack(alignment: .leading, spacing: 0) {
                List {
                    Section { ShowPickerRow(model: picker) }
                    if let s = vm.summary {
                        Section("Summary") {
                            HStack {
                                kpi("\(s.totalQty)", "tickets")
                                kpi(money(s.totalRevenue), "revenue")
                                kpi(money(s.totalFees), "fees")
                                kpi("\(s.scannedQty)", "scanned")
                                kpi("\(s.unscannedQty)", "unscanned")
                            }
                            let completeness = BoxOfficeCompleteness.from(summary: s)
                            HStack {
                                Text("Completeness").foregroundStyle(.secondary)
                                Spacer()
                                Text("\(Int((completeness.score * 100).rounded()))%")
                                    .monospacedDigit()
                                    .foregroundStyle(completeness.score >= 1 ? LariatTheme.ok : LariatTheme.warn)
                            }
                            .font(.callout)
                        }
                    }
                    if let submitError = vm.submitError {
                        Section { Text(submitError).font(.callout).foregroundStyle(LariatTheme.bad) }
                    }
                    Section("Lines (\(vm.lines.count))") {
                        if vm.lines.isEmpty {
                            EmptyState(message: "No ticket lines yet.", systemImage: "ticket")
                        } else {
                            ForEach(vm.lines) { line in lineRow(line) }
                        }
                    }
                }
                HStack {
                    Spacer()
                    Button("Add line") { vm.showForm = true }
                        .disabled(picker.selectedShow == nil)
                        .padding()
                }
            }
        }
    }

    @ViewBuilder
    private func lineRow(_ line: BoxOfficeLineRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(SettlementPrintCompute.sourceLabel(line.source)).font(.callout)
                    if let cls = line.ticketClass {
                        Text(cls).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if let ref = line.externalRef {
                    Text(ref).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(line.qty) × \(money(line.facePrice ?? 0))").monospacedDigit().font(.callout)
                if let fees = line.fees, fees != 0 {
                    Text("+ \(money(fees)) fees").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if line.scannedAt != nil {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(LariatTheme.ok)
                    .help("Scanned in")
            } else {
                Button("Scan") { vm.markScanned(line) }
                    .buttonStyle(.bordered)
            }
        }
    }

    // ── Add-line form ─────────────────────────────────────────────────

    @ViewBuilder
    private var addForm: some View {
        NavigationStack {
            Form {
                Picker("Source", selection: $vm.formSource) {
                    ForEach(BoxOfficeSource.allCases, id: \.rawValue) { src in
                        Text(SettlementPrintCompute.sourceLabel(src.rawValue)).tag(src.rawValue)
                    }
                }
                TextField("Qty", text: $vm.formQty)
                TextField("Face price ($)", text: $vm.formFacePrice)
                TextField("Fees ($)", text: $vm.formFees)
                TextField("Ticket class (optional)", text: $vm.formTicketClass)
                TextField("External ref (optional)", text: $vm.formExternalRef)
                TextField("Notes (optional)", text: $vm.formNotes)
                if let submitError = vm.submitError {
                    Text(submitError).font(.caption).foregroundStyle(LariatTheme.bad)
                }
            }
            .navigationTitle("Add a ticket line")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showForm = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { vm.submitLine() }
                        .disabled(vm.formQty.isEmpty)
                }
            }
        }
        .frame(minWidth: 380, minHeight: 400)
    }

    @ViewBuilder
    private func kpi(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func money(_ dollars: Double) -> String {
        String(format: "$%.2f", dollars)
    }
}

/// Box-office view model — polls the selected show's lines every 5 s.
@Observable @MainActor
final class ShowBoxOfficeViewModel {
    var lines: [BoxOfficeLineRow] = []
    var summary: BoxOfficeDbSummary?
    var fetchError: String?
    var submitError: String?
    var showForm = false

    // Add-line form state.
    var formSource = BoxOfficeSource.walkup.rawValue
    var formQty = ""
    var formFacePrice = ""
    var formFees = ""
    var formTicketClass = ""
    var formExternalRef = ""
    var formNotes = ""

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

    func start(picker: ShowPickerModel) {
        self.picker = picker
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stop() { pollTask?.cancel() }

    func refresh() async {
        guard let showId = picker?.selectedShowId else {
            lines = []
            summary = nil
            return
        }
        let repo = BoxOfficeRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
        do {
            lines = try await repo.listLines(showId: showId)
            summary = try await repo.summarize(showId: showId)
            fetchError = nil
        } catch {
            fetchError = "Could not load box office"
        }
    }

    func submitLine() {
        submitError = nil
        guard let showId = picker?.selectedShowId else {
            submitError = "Pick a show first."
            return
        }
        guard let qty = Int(formQty.trimmingCharacters(in: .whitespaces)), qty > 0 else {
            submitError = "qty must be a positive integer"
            return
        }
        do {
            let user = try gateModel.actorForWrite()
            let repo = BoxOfficeRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
            _ = try repo.createLine(
                BoxOfficeCreateLineInput(
                    showId: showId,
                    source: formSource,
                    ticketClass: emptyToNil(formTicketClass),
                    qty: qty,
                    facePrice: parseDollars(formFacePrice),
                    fees: parseDollars(formFees),
                    externalRef: emptyToNil(formExternalRef),
                    notes: emptyToNil(formNotes)
                ),
                context: writeContext(user)
            )
            resetForm()
            showForm = false
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    func markScanned(_ line: BoxOfficeLineRow) {
        submitError = nil
        guard let showId = picker?.selectedShowId else { return }
        do {
            let user = try gateModel.actorForWrite()
            let repo = BoxOfficeRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
            let scanned = try repo.markScanned(showId: showId, lineId: line.id, context: writeContext(user))
            if scanned == nil {
                // Web 404 semantics: already scanned / show mismatch.
                submitError = "NotFound or already scanned"
            }
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    // ── helpers ───────────────────────────────────────────────────────

    private func writeContext(_ user: ManagerPinUser?) -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: user.map { String($0.id) },
            actorSource: RegulatedWriteContext.nativeMacActorSource,
            locationId: locationId,
            shiftDate: ShiftDate.todayISO()
        )
    }

    private func emptyToNil(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func parseDollars(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return nil }
        return Double(t)
    }

    private func resetForm() {
        formSource = BoxOfficeSource.walkup.rawValue
        formQty = ""
        formFacePrice = ""
        formFees = ""
        formTicketClass = ""
        formExternalRef = ""
        formNotes = ""
    }
}
