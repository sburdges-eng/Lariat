import SwiftUI
import LariatDB
import LariatModel
import Observation
#if canImport(AppKit)
import AppKit
#endif

/// Settlement — native port of `app/shows/[id]/settlement` (page +
/// `DealEditor.jsx` + GET settlement + PUT deal + the print view).
/// MONEY-CRITICAL: everything renders from the Int-cents
/// `SettlementSummary`; the deal editor converts dollars → cents via
/// `Decimal` before the PUT-parity validation. The print COMPUTATION is
/// rendered as a monospaced text preview (macOS print chrome = H6,
/// deferred-cosmetic). PIN-gated whole-board; the deal write is regulated
/// (audit_events insert/correction in-tx).
struct ShowSettlementView: View {
    @State private var gateModel: ShowsGateModel
    @State private var picker: ShowPickerModel
    @State private var vm: ShowSettlementViewModel

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        let gate = ShowsGateModel(database: database, writeDatabase: writeDatabase)
        _gateModel = State(wrappedValue: gate)
        _picker = State(wrappedValue: ShowPickerModel(database: database))
        _vm = State(wrappedValue: ShowSettlementViewModel(
            readDB: database, writeDB: writeDatabase, gateModel: gate
        ))
    }

    var body: some View {
        ShowsGatedBoard(gateModel: gateModel, title: "Settlement") {
            content
                .task {
                    await picker.load()
                    vm.start(picker: picker)
                }
                .onDisappear { vm.stop() }
                .sheet(isPresented: $vm.showDealEditor) { dealEditor }
                .sheet(isPresented: $vm.showPrintPreview) { printPreview }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = vm.fetchError, vm.summary == nil {
            TileDegrade(title: "Could not load settlement", message: err, systemImage: "dollarsign.square")
        } else {
            VStack(alignment: .leading, spacing: 0) {
                List {
                    Section { ShowPickerRow(model: picker) }
                    if let s = vm.summary {
                        ticketsSection(s)
                        toastSection(s)
                        dealSection(s)
                        talentSection(s)
                        netDoorSection(s)
                    } else {
                        Section { ProgressView("Computing settlement…") }
                    }
                }
                HStack {
                    if let err = vm.submitError {
                        Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
                    }
                    Spacer()
                    Button("Print preview") { vm.showPrintPreview = true }
                        .disabled(vm.summary == nil)
                    Button("Edit deal") { vm.openDealEditor() }
                        .disabled(picker.selectedShow == nil)
                        .buttonStyle(.borderedProminent)
                }
                .padding()
            }
        }
    }

    // ── Sections (mirroring the web cards) ────────────────────────────

    @ViewBuilder
    private func ticketsSection(_ s: SettlementSummary) -> some View {
        Section("Tickets") {
            moneyRow("Gross", s.ticketing.grossCents)
            moneyRow("Fees", s.ticketing.feesCents)
            moneyRow("Net", s.ticketing.netCents, strong: true)
            let sources = SettlementPrintCompute.ticketSourceRows(s)
            if sources.isEmpty {
                EmptyState(message: "No ticket lines yet.", systemImage: "ticket")
            } else {
                ForEach(Array(sources.enumerated()), id: \.offset) { _, src in
                    HStack {
                        Text(src.label).foregroundStyle(.secondary)
                        Spacer()
                        Text("\(src.qty) · \(SettlementPrintCompute.dollars(src.grossCents))")
                            .monospacedDigit()
                    }
                    .font(.callout)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    @ViewBuilder
    private func toastSection(_ s: SettlementSummary) -> some View {
        Section("Toast") {
            moneyRow("Net sales", s.toast.totalCents)
            plainRow("Orders", String(s.toast.ordersCount))
            plainRow("Guests", String(s.toast.guestsCount))
            if let warning = SettlementPrintCompute.toastWarning(s) {
                Text(warning).font(.caption).foregroundStyle(LariatTheme.warn)
            }
        }
    }

    @ViewBuilder
    private func dealSection(_ s: SettlementSummary) -> some View {
        Section("Deal terms") {
            moneyRow("Guarantee", s.deal.guaranteeCents)
            plainRow("vs % after costs", SettlementPrintCompute.vsPctLabel(s.deal.vsPctAfterCosts))
            moneyRow("Buyout", s.deal.buyoutCents)
        }
        Section("Costs off top") {
            if s.deal.costsOffTop.isEmpty {
                EmptyState(message: "No costs off top.", systemImage: "minus.circle")
            } else {
                ForEach(Array(s.deal.costsOffTop.enumerated()), id: \.offset) { _, cost in
                    moneyRow(cost.label, cost.cents)
                }
                moneyRow("Total costs off top", s.costsOffTopCents, strong: true)
            }
        }
    }

    @ViewBuilder
    private func talentSection(_ s: SettlementSummary) -> some View {
        Section("Talent payout") {
            moneyRow("Guarantee", s.talent.guaranteeCents)
            moneyRow("vs bonus", s.talent.vsBonusCents)
            moneyRow("Buyout", s.talent.buyoutCents)
            moneyRow("Total", s.talent.totalCents, strong: true)
        }
    }

    @ViewBuilder
    private func netDoorSection(_ s: SettlementSummary) -> some View {
        Section("Net to door") {
            VStack(alignment: .leading, spacing: 4) {
                Text(SettlementPrintCompute.dollars(s.netDoorCents))
                    .font(.system(size: 34, weight: .bold)).monospacedDigit()
                    .foregroundStyle(s.netDoorCents < 0 ? LariatTheme.bad : .primary)
                Text("tickets net − costs off top − talent payout")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
    }

    // ── Deal editor (PUT /deal parity) ────────────────────────────────

    @ViewBuilder
    private var dealEditor: some View {
        NavigationStack {
            Form {
                TextField("Guarantee ($)", text: $vm.formGuarantee)
                TextField("vs % after costs (0–100, blank = flat)", text: $vm.formVsPct)
                TextField("Buyout ($)", text: $vm.formBuyout)
                Section("Costs off top") {
                    // Identity-based ForEach + delete-by-id: index bindings
                    // with remove(at:) fatal-error when SwiftUI re-resolves a
                    // stale $vm.formCosts[i] past the new count (e.g. deleting
                    // row 0 while a later row's field holds focus).
                    ForEach($vm.formCosts) { $cost in
                        HStack {
                            TextField("Label", text: $cost.label)
                            TextField("$", text: $cost.amount)
                                .frame(width: 100)
                                .accessibilityLabel("Amount in dollars for \(cost.label.isEmpty ? "this cost" : cost.label)")
                            Button(role: .destructive) {
                                vm.formCosts.removeAll { $0.id == cost.id }
                            } label: { Image(systemName: "trash") }
                            .accessibilityLabel("Delete cost \(cost.label.isEmpty ? "(unnamed)" : cost.label)")
                        }
                    }
                    Button("Add cost") { vm.formCosts.append(.init()) }
                }
                if let err = vm.submitError {
                    Text(err).font(.caption).foregroundStyle(LariatTheme.bad)
                }
            }
            .navigationTitle("Deal terms")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showDealEditor = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { vm.saveDeal() }
                }
            }
        }
        .frame(minWidth: 420, minHeight: 420)
    }

    // ── Print preview (settlementPrint computation) ───────────────────

    @ViewBuilder
    private var printPreview: some View {
        NavigationStack {
            ScrollView {
                if let s = vm.summary {
                    Text(SettlementPrintCompute.renderText(s))
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
            }
            .navigationTitle("Settlement sheet")
            .toolbar {
                #if canImport(AppKit)
                ToolbarItem {
                    Button("Copy") {
                        if let s = vm.summary {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(
                                SettlementPrintCompute.renderText(s), forType: .string)
                        }
                    }
                    .disabled(vm.summary == nil)
                }
                ToolbarItem {
                    Button("Print") {
                        if let s = vm.summary { Self.printSettlement(s) }
                    }
                    .disabled(vm.summary == nil)
                }
                #endif
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { vm.showPrintPreview = false }
                }
            }
        }
        .frame(minWidth: 520, minHeight: 560)
    }

    #if canImport(AppKit)
    /// Print the SAME monospaced settlement text the preview renders —
    /// `SettlementPrintCompute.renderText` stays the single computation.
    private static func printSettlement(_ s: SettlementSummary) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 486, height: 700))
        textView.string = SettlementPrintCompute.renderText(s)
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        let operation = NSPrintOperation(view: textView)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }
    #endif

    // ── row helpers ───────────────────────────────────────────────────

    @ViewBuilder
    private func moneyRow(_ label: String, _ cents: Int, strong: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(strong ? .primary : .secondary)
            Spacer()
            Text(SettlementPrintCompute.dollars(cents))
                .monospacedDigit()
                .fontWeight(strong ? .bold : .regular)
        }
        .font(.callout)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func plainRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).monospacedDigit()
        }
        .font(.callout)
        .accessibilityElement(children: .combine)
    }
}

/// Settlement view model — polls the Int-cents summary every 5 s; the deal
/// editor round-trips dollars ↔ cents via `Decimal` (half-away-from-zero,
/// the web `Math.round(x*100)` analog).
@Observable @MainActor
final class ShowSettlementViewModel {
    struct CostDraft: Identifiable {
        let id = UUID()
        var label = ""
        var amount = ""
    }

    var summary: SettlementSummary?
    var fetchError: String?
    var submitError: String?
    var showDealEditor = false
    var showPrintPreview = false

    var formGuarantee = ""
    var formVsPct = ""
    var formBuyout = ""
    var formCosts: [CostDraft] = []

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
            summary = nil
            return
        }
        let repo = ShowSettlementRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
        do {
            summary = try await repo.getSettlement(showId: showId)
            fetchError = nil
        } catch {
            fetchError = "Could not load the settlement"
        }
    }

    func openDealEditor() {
        submitError = nil
        let deal = summary?.deal ?? DealPointsCompute.emptyDeal()
        formGuarantee = centsToDollarsText(deal.guaranteeCents)
        formBuyout = centsToDollarsText(deal.buyoutCents)
        formVsPct = deal.vsPctAfterCosts.map { trimTrailingZeros($0 * 100) } ?? ""
        formCosts = deal.costsOffTop.map {
            CostDraft(label: $0.label, amount: centsToDollarsText($0.cents))
        }
        showDealEditor = true
    }

    func saveDeal() {
        submitError = nil
        guard let showId = picker?.selectedShowId else {
            submitError = "Pick a show first."
            return
        }
        guard let guaranteeCents = dollarsToCents(formGuarantee.isEmpty ? "0" : formGuarantee) else {
            submitError = "guaranteeCents: non-negative integer required"
            return
        }
        guard let buyoutCents = dollarsToCents(formBuyout.isEmpty ? "0" : formBuyout) else {
            submitError = "buyoutCents: non-negative integer required"
            return
        }
        var vsPct: Double?
        let pctText = formVsPct.trimmingCharacters(in: .whitespaces)
        if !pctText.isEmpty {
            guard let pct = Double(pctText) else {
                submitError = "vsPctAfterCosts: null or 0-1"
                return
            }
            vsPct = pct / 100
        }
        var costs: [DealCost] = []
        for draft in formCosts {
            let label = draft.label.trimmingCharacters(in: .whitespaces)
            guard !label.isEmpty else { continue }
            guard let cents = dollarsToCents(draft.amount.isEmpty ? "0" : draft.amount) else {
                submitError = "costsOffTop: non-negative amount required"
                return
            }
            costs.append(DealCost(label: label, cents: cents))
        }
        let deal = DealPoint(
            guaranteeCents: guaranteeCents,
            vsPctAfterCosts: vsPct,
            costsOffTop: costs,
            buyoutCents: buyoutCents
        )
        let user: ManagerPinUser?
        do {
            user = try gateModel.actorForWrite()
        } catch {
            // actorForWrite presented the PIN sheet, which can't show over
            // the deal-editor sheet on macOS (PR #401). Dismiss the form,
            // stash the save (form fields survive in the VM), replay after
            // a successful verify — and report a cancelled PIN instead of
            // silently dropping the deal.
            showDealEditor = false
            gateModel.stashPendingWrite(
                retry: { [weak self] in self?.saveDeal() },
                onCancel: { [weak self] in
                    self?.submitError = "PIN required — deal not saved. Reopen “Edit deal” to try again."
                }
            )
            return
        }
        do {
            let repo = ShowSettlementRepository(readDB: readDB, writeDB: writeDB, locationId: locationId)
            try repo.upsertDeal(
                showId: showId,
                deal: deal,
                cookId: user.map { String($0.id) } ?? "unknown",
                context: RegulatedWriteContext(
                    actorCookId: user.map { String($0.id) },
                    actorSource: RegulatedWriteContext.nativeMacActorSource,
                    locationId: locationId,
                    shiftDate: ShiftDate.todayISO()
                )
            )
            showDealEditor = false
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    // ── money text helpers (Decimal, half-away-from-zero) ─────────────

    func dollarsToCents(_ s: String) -> Int? {
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        guard let dollars = Decimal(string: trimmed), dollars >= 0 else { return nil }
        let handler = NSDecimalNumberHandler(
            roundingMode: .plain, scale: 0,
            raiseOnExactness: false, raiseOnOverflow: false,
            raiseOnUnderflow: false, raiseOnDivideByZero: false
        )
        return NSDecimalNumber(decimal: dollars * 100).rounding(accordingToBehavior: handler).intValue
    }

    private func centsToDollarsText(_ cents: Int) -> String {
        cents == 0 ? "" : String(format: "%d.%02d", cents / 100, abs(cents) % 100)
    }

    private func trimTrailingZeros(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(n)
    }
}
