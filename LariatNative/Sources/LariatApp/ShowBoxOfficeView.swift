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
                            .accessibilityElement(children: .combine)
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
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(lineRowAccessibilityLabel(line))

            if line.scannedAt != nil {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(LariatTheme.ok)
                    .help("Scanned in")
                    .accessibilityLabel("Scanned in")
            } else {
                Button("Scan") { vm.markScanned(line) }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Scan in \(SettlementPrintCompute.sourceLabel(line.source)) ticket line")
            }
        }
    }

    /// Verbalizes the line's source/class/ref + qty/price/fees fragments as one
    /// VoiceOver stop; the scan-state icon/button stays a sibling outside this
    /// combine scope so it remains independently reachable/interactive.
    private func lineRowAccessibilityLabel(_ line: BoxOfficeLineRow) -> String {
        var parts = [SettlementPrintCompute.sourceLabel(line.source)]
        if let cls = line.ticketClass { parts.append(cls) }
        if let ref = line.externalRef { parts.append(ref) }
        parts.append("\(line.qty) at \(money(line.facePrice ?? 0)) each")
        if let fees = line.fees, fees != 0 {
            parts.append("plus \(money(fees)) fees")
        }
        return parts.joined(separator: ", ")
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
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
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
        // Money fields are cash custody: unparseable text ("$15", "12,50")
        // must abort, never silently coerce to a nil price.
        let facePrice: Double?
        switch Self.parseMoneyField(formFacePrice) {
        case .empty: facePrice = nil
        case .value(let v): facePrice = v
        case .invalid:
            submitError = "face price must be a number (e.g. 15 or 15.50)"
            return
        }
        let fees: Double?
        switch Self.parseMoneyField(formFees) {
        case .empty: fees = nil
        case .value(let v): fees = v
        case .invalid:
            submitError = "fees must be a number (e.g. 2 or 2.50)"
            return
        }
        let user: ManagerPinUser?
        do {
            user = try gateModel.actorForWrite()
        } catch {
            // actorForWrite presented the PIN sheet, which can't show over
            // the add-line sheet on macOS (PR #401). Dismiss the form, stash
            // the submit (fields survive in the VM), replay after a verify —
            // and report a cancelled PIN instead of silently dropping it.
            showForm = false
            gateModel.stashPendingWrite(
                retry: { [weak self] in self?.submitLine() },
                onCancel: { [weak self] in
                    self?.submitError = "PIN required — line not saved. Reopen “Add line” to try again."
                }
            )
            return
        }
        do {
            let repo = BoxOfficeRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
            _ = try repo.createLine(
                BoxOfficeCreateLineInput(
                    showId: showId,
                    source: formSource,
                    ticketClass: emptyToNil(formTicketClass),
                    qty: qty,
                    facePrice: facePrice,
                    fees: fees,
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
                // Web 404 semantics: already scanned / show mismatch —
                // rendered in operator language, not API jargon.
                submitError = "That line was already scanned in (or belongs to another show)."
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

    /// Tri-state money parse: blank is a legitimate "no price", but non-empty
    /// text that isn't a number is a validation error, never a silent nil.
    enum MoneyField: Equatable {
        case empty
        case value(Double)
        case invalid
    }

    static func parseMoneyField(_ s: String) -> MoneyField {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return .empty }
        guard let v = Double(t) else { return .invalid }
        return .value(v)
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
