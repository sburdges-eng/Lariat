import SwiftUI
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

/// Backs `costing.depletionExceptions` — "sales whose dish didn't pull from
/// inventory." Mirrors `app/costing/depletion-exceptions/page.jsx`. Polls
/// every 3 s (`CostingViewModel` / `PriceShocksViewModel` /
/// `VarianceAttributionViewModel` precedent) since GRDB's `ValueObservation`
/// can't see cross-process writes from the web app.
///
/// Pure read board — no PIN gate. The web route (route.js) IS PIN-gated
/// (`requirePin`), but native manager/costing-tier reads are not per-view
/// PIN-gated today, matching the priceShocks/varianceAttribution boards —
/// a deliberate divergence, not an oversight. No write path — no
/// `AuditedWriteRunner`.
@Observable @MainActor final class DepletionExceptionsViewModel {
    var exceptions: [DepletionException] = []
    var totalSalesRows: Int = 0
    var errorText: String?
    var isLoading = true

    private let poller = BoardPoller()
    private let database: LariatDatabase
    private let repo: DepletionExceptionsRepository

    init(database: LariatDatabase) {
        self.database = database
        self.repo = DepletionExceptionsRepository(database: database)
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.errorText)
        }
    }

    func stop() { poller.stop() }

    private func refresh() async {
        do {
            let list = try await repo.list()
            self.exceptions = list
            self.errorText = nil
            self.isLoading = false
        } catch {
            self.errorText = "Fetch error: \(error.localizedDescription)"
            self.isLoading = false
        }
    }
}

// MARK: - Root view

struct DepletionExceptionsView: View {
    @State private var vm: DepletionExceptionsViewModel
    private let navigate: (String) -> Void

    init(database: LariatDatabase, navigate: @escaping (String) -> Void = { _ in }) {
        _vm = State(wrappedValue: DepletionExceptionsViewModel(database: database))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if vm.isLoading {
                ProgressView()
            } else {
                DepletionExceptionsContentView(exceptions: vm.exceptions, navigate: navigate)
            }
        }
        .navigationTitle("Depletion exceptions")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

// MARK: - Content

private struct DepletionExceptionsContentView: View {
    let exceptions: [DepletionException]
    let navigate: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Sales whose dish didn't pull from inventory. Add the dish's ingredients "
                    + "in \u{201c}what\u{2019}s in dishes\u{201d} and it drops off this list after the next reload.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                if exceptions.isEmpty {
                    TileDegrade(
                        title: "Nothing to triage",
                        message: "Every dish currently sold maps cleanly to dish_components.",
                        systemImage: "checkmark.circle"
                    )
                    .padding(.horizontal)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(exceptions) { e in
                            DepletionExceptionRow(item: e, navigate: navigate)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
    }
}

private struct DepletionExceptionRow: View {
    let item: DepletionException
    let navigate: (String) -> Void

    private var tone: DepletionReasonTone { DepletionReasonLabels.tone(item.reason) }
    private var toneColor: Color {
        switch tone {
        case .red: return .red
        case .blue: return .blue
        case .yellow: return .yellow
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle()
                .fill(toneColor)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 4) {
                // Fix-it deep link (page.jsx L143-149): the dish name opens
                // the dish-components editor (`costing.components`). The web
                // link pre-fills ?dish=; native lands on the editor and the
                // operator picks the dish from Suggestions (no route-payload
                // channel yet — noted in the audit report).
                Button {
                    navigate("costing.components")
                } label: {
                    Text(item.dishName).font(.headline)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.blue)
                .help("Fix in dish components — add this dish's per-serving ingredients")

                HStack(spacing: 4) {
                    Text(DepletionReasonLabels.label(item.reason))
                        .font(.caption)
                        .foregroundStyle(toneColor)
                    if let detail = item.detail {
                        Text("· \(detail)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospaced()
                    }
                }

                Text(metaLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if !item.samplePeriodLabels.isEmpty {
                    Text("Periods: \(item.samplePeriodLabels.joined(separator: ", "))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            Text(fmtMoney(item.totalNetSales))
                .font(.title3)
                .bold()
                .foregroundStyle(toneColor)
                .monospacedDigit()
        }
        .padding(.vertical, 6)
    }

    private var metaLine: String {
        let salesWord = item.affectedSalesCount == 1 ? "sales row" : "sales rows"
        var parts = ["\(item.affectedSalesCount) \(salesWord)", "\(fmtQty(item.totalQuantitySold)) sold", "\(fmtMoney(item.totalNetSales)) net"]
        if let last = item.latestImportedAt {
            parts.append("last seen \(last)")
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Formatting helpers (verbatim ports of page.jsx:27-47)

/// `fmtCurrency`/`formatDollars` — signed 2-decimal dollars; nil/non-finite -> "—".
private func fmtMoney(_ n: Double?) -> String {
    guard let n, n.isFinite else { return "—" }
    let sign = n < 0 ? "-" : ""
    return String(format: "%@$%.2f", sign, abs(n))
}

/// `fmtQty` — page.jsx:31-35. Integer values render without decimals.
private func fmtQty(_ n: Double?) -> String {
    guard let n, n.isFinite else { return "—" }
    if n == n.rounded() { return String(Int(n)) }
    return String(format: "%.2f", n)
}
