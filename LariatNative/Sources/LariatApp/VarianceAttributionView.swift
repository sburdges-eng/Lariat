import SwiftUI
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

/// Backs `costing.varianceAttribution` — "the variance moved, what did we change?"
/// Mirrors `app/costing/variance-attribution/page.jsx`. Polls every 3 s
/// (`CostingViewModel` / `PriceShocksViewModel` precedent) since GRDB's
/// `ValueObservation` can't see cross-process writes from the web app.
///
/// Pure read board — no PIN gate (the web route has no in-route PIN either,
/// only /costing middleware gating; native manager-tier reads don't gate today).
/// No write path — no `AuditedWriteRunner`.
@Observable @MainActor final class VarianceAttributionViewModel {
    var result: VarianceAttributionResult?
    var errorText: String?
    var isLoading = true
    /// Read gate (C1 verify-41 T7): the web `/api/costing/*` GET is
    /// middleware-PIN-gated. The View shows a locked panel when not `.open`.
    var gate: RegulatedReadGateState = .open
    var showPinSheet = false

    let poller = BoardPoller()
    private let database: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let repo: VarianceAttributionRepository

    init(database: LariatDatabase, writeDB: LariatWriteDatabase? = nil) {
        self.database = database
        self.writeDB = writeDB
        self.repo = VarianceAttributionRepository(database: database)
    }

    var writeDatabase: LariatWriteDatabase? { writeDB }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    /// Sync so the `pool.read` closure runs off the async path.
    private func evaluateReadGate() -> RegulatedReadGateState {
        let gateOn = (try? database.pool.read { db in
            try PinVerifier().gateConfigured(db: db)
        }) ?? PinVerifier().gateConfigured()
        return RegulatedReadGate.evaluate(
            gateConfigured: gateOn,
            hasActiveUser: PinSessionStore.shared.activeUser != nil,
            canUnlock: writeDB != nil
        )
    }

    func requestUnlock() { if writeDB != nil { showPinSheet = true } }

    func pinVerified(_ user: ManagerPinUser) {
        PinSessionStore.shared.save(user: user)
        showPinSheet = false
        Task { await refresh() }
    }

    private func refresh() async {
        // Read gate (C1 verify-41 T7): the web costing GET is PIN-gated.
        gate = evaluateReadGate()
        guard gate == .open else {
            result = nil
            errorText = nil
            isLoading = false
            return
        }
        do {
            let r = try await repo.load()
            self.result = r
            self.errorText = nil
            self.isLoading = false
        } catch {
            self.errorText = "Fetch error: \(error.localizedDescription)"
            self.isLoading = false
        }
    }
}

// MARK: - Root view

struct VarianceAttributionView: View {
    @State private var vm: VarianceAttributionViewModel
    init(database: LariatDatabase, writeDB: LariatWriteDatabase? = nil) {
        _vm = State(wrappedValue: VarianceAttributionViewModel(database: database, writeDB: writeDB))
    }

    var body: some View {
        Group {
            switch vm.gate {
            case .locked, .unavailable:
                ReadGateLockedView(title: "Variance attribution", state: vm.gate) { vm.requestUnlock() }
            case .open:
                if let err = vm.errorText {
                    TileDegrade(
                        title: "Database unavailable",
                        message: err,
                        systemImage: "externaldrive.badge.xmark"
                    )
                } else if let r = vm.result {
                    VarianceAttributionContentView(result: r)
                } else {
                    ProgressView()
                }
            }
        }
        .navigationTitle("Variance attribution")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showPinSheet) {
            if let db = vm.writeDatabase {
                PinEntrySheet(database: db) { user in vm.pinVerified(user) }
            }
        }
    }
}

// MARK: - Content

private struct VarianceAttributionContentView: View {
    let result: VarianceAttributionResult

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("The variance moved — what did we change?")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                if !result.ok {
                    TileDegrade(
                        title: "No attribution available",
                        message: result.reason ?? "Unable to attribute this window.",
                        systemImage: "questionmark.circle"
                    )
                    .padding(.horizontal)
                } else {
                    HeaderCard(result: result)
                        .padding(.horizontal)

                    SectionCard(
                        title: "Price moves",
                        sub: windowSub("Vendor unit prices that changed between", result: result),
                        count: result.priceMoves.count,
                        emptyMessage: "No vendor price moves inside this window."
                    ) {
                        PriceMovesTable(items: result.priceMoves)
                    }
                    .padding(.horizontal)

                    SectionCard(
                        title: "Dish composition changes",
                        sub: "dish_components rows created or edited inside the window.",
                        count: result.compositionChanges.count,
                        emptyMessage: "No dish composition edits inside this window."
                    ) {
                        CompositionChangesTable(items: result.compositionChanges)
                    }
                    .padding(.horizontal)

                    SectionCard(
                        title: "Count corrections",
                        sub: "Inventory counts closed/reopened and count-line corrections inside the window.",
                        count: result.countCorrections.count,
                        emptyMessage: "No count activity inside this window."
                    ) {
                        CountCorrectionsTable(items: result.countCorrections)
                    }
                    .padding(.horizontal)

                    SectionCard(
                        title: "Unresolved depletions",
                        sub: "Items sold with no dish_components link — sales the theoretical COGS never depleted.",
                        count: result.unresolvedDepletions.count,
                        emptyMessage: "No unresolved sales lines inside this window.",
                        note: result.unresolvedNote
                    ) {
                        UnresolvedDepletionsTable(items: result.unresolvedDepletions)
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
    }

    private func windowSub(_ prefix: String, result: VarianceAttributionResult) -> String {
        "\(prefix) \(result.window.from ?? "—") and \(result.window.to ?? "—")."
    }
}

// MARK: - Header (baseline -> current, delta, caveat, unattributed note)

private struct HeaderCard: View {
    let result: VarianceAttributionResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 24) {
                PeriodBadge(period: result.variance.baseline, title: "Baseline")
                Text("→").foregroundStyle(.secondary)
                PeriodBadge(period: result.variance.current, title: "Current")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Move").font(.caption2).foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        Text(fmtPct(result.variance.deltaPct)).bold().monospacedDigit()
                        Text("· \(fmtMoney(result.variance.deltaAmount))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }
                .accessibilityElement(children: .combine)
            }
            Text(result.caveat)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            if result.unattributed {
                Text("No in-window evidence found — nothing in price history, dish components, "
                    + "count corrections, or unresolved depletions for this window.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct PeriodBadge: View {
    let period: VarianceAttrPeriod?
    let title: String

    private func color(_ tc: ThresholdColor) -> Color {
        switch tc {
        case .green:  return .green
        case .yellow: return .yellow
        case .red:    return .red
        }
    }

    /// Tone word for `color`'s yellow/red buckets only — green already reads
    /// unambiguously via the signed percentage itself.
    private func toneWord(_ tc: ThresholdColor) -> String? {
        switch tc {
        case .green:  return nil
        case .yellow: return "elevated variance"
        case .red:    return "high variance"
        }
    }

    var body: some View {
        if let p = period {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(title) (\(p.periodEnd))").font(.caption2).foregroundStyle(.secondary)
                Text(fmtPct(p.variancePct))
                    .bold()
                    .monospacedDigit()
                    .foregroundStyle(color(p.thresholdColor))
                Text(fmtMoney(p.varianceAmount))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabelText(p))
        } else {
            Text("\(title): —").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func accessibilityLabelText(_ p: VarianceAttrPeriod) -> String {
        var text = "\(title) (\(p.periodEnd)): \(fmtPct(p.variancePct))"
        if let word = toneWord(p.thresholdColor) {
            text += ", \(word)"
        }
        text += ", \(fmtMoney(p.varianceAmount))"
        return text
    }
}

// MARK: - Shared section card wrapper

private struct SectionCard<Content: View>: View {
    let title: String
    let sub: String
    let count: Int
    let emptyMessage: String
    var note: String? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).font(.headline)
                Text("(\(count))").font(.caption).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)

            Text(sub)
                .font(.caption)
                .foregroundStyle(.secondary)

            if let note {
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if count == 0 {
                Text(emptyMessage)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 8)
            } else {
                content()
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Section tables

private struct PriceMovesTable: View {
    let items: [PriceMoveItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, m in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.ingredient).bold()
                        Text("\(m.vendor) · \(m.sku)").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(fmtPct(m.pctMove)).bold().monospacedDigit()
                        Text("\(fmtOptDouble(m.firstPrice)) → \(fmtOptDouble(m.lastPrice)) (\(m.snapshots) snapshots)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(m.linkedToMenu ? "linked to a dish" : "—")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}

private struct CompositionChangesTable: View {
    let items: [CompositionChangeItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, c in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.dishName).bold()
                        Text("\(c.component) (\(c.componentType))").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(c.changeKind).font(.caption).foregroundStyle(.secondary)
                        Text(c.changedAt).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}

private struct CountCorrectionsTable: View {
    let items: [CountCorrectionItem]

    private func describe(_ row: CountCorrectionItem) -> String {
        if row.kind == "count_closed" {
            let label = row.label ?? row.countDate ?? "#\(row.countId.map(String.init) ?? "?")"
            return "Count closed — \(label) (\(row.lines ?? 0) lines)"
        }
        let what = row.entity == "inventory_count_lines" ? "count line" : "count"
        let verb = row.transition ?? row.action ?? "changed"
        let who = row.actorCookId.map { " by \($0)" } ?? ""
        return "\(what) \(verb)\(who)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(describe(row)).font(.caption)
                    Spacer()
                    Text(row.at).font(.caption2).foregroundStyle(.tertiary)
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}

private struct UnresolvedDepletionsTable: View {
    let items: [UnresolvedDepletionItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, u in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(u.itemName).bold()
                        Text(u.periodLabel ?? "—").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(u.qtySold.map { fmtOptDouble($0) } ?? "—").font(.caption).monospacedDigit()
                        Text(fmtMoney(u.netSales)).font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}

// MARK: - Formatting helpers (verbatim ports of page.jsx:29-40)
//
// fmtPct is shared with PriceShocksView.swift (byte-identical port of the same
// page.jsx-style helper) — reused here, not re-derived.

/// `fmtMoney` — page.jsx:36-40. Signed 2-decimal dollars; nil/non-finite -> "—".
private func fmtMoney(_ n: Double?) -> String {
    guard let n, n.isFinite else { return "—" }
    let sign = n < 0 ? "-" : ""
    return String(format: "%@$%.2f", sign, abs(n))
}

private func fmtOptDouble(_ n: Double?) -> String {
    guard let n else { return "—" }
    if n == n.rounded() { return String(Int(n)) }
    return String(n)
}
