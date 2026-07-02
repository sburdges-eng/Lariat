import SwiftUI
import LariatDB
import LariatModel
import Observation

// MARK: - ViewModel

@Observable @MainActor final class CommandViewModel {
    var summary: CommandSummary?
    var alerts: [CommandAlert] = []
    var errorText: String?
    private var streamTask: Task<Void, Never>?
    private let database: LariatDatabase

    init(database: LariatDatabase) {
        self.database = database
    }

    func start() {
        streamTask?.cancel()
        let locationId = LocationScope.resolve()
        let commandRepo = CommandRepository(database: database, locationId: locationId)
        let rollupRepo = ManagementRollupRepository(database: database, locationId: locationId)
        let marginRepo = MarginDeltasRepository(database: database, locationId: locationId)

        streamTask = Task { [weak self] in
            // Mirror ManagementRollupViewModel polling pattern:
            // ValueObservation can't see cross-process writes, so we poll every 3 s.
            while !Task.isCancelled {
                let today = Self.todayISO()

                // Fetch CommandBundle, price shocks, and margin moves concurrently.
                async let bundleResult = commandRepo.fetch(today: today)
                async let rollupResult = rollupRepo.load()
                async let marginResult = marginRepo.summary()   // 7 / 5 / 100 = Command window

                do {
                    let bundle = try await bundleResult

                    // Thread the REAL price-shock summary into summarize() so the
                    // Price-moves tile is not silently zero. Map PriceShockSummary →
                    // CommandCompute.MoveSummary (total/up/down).
                    let priceMoves: CommandCompute.MoveSummary
                    if let shocks = try? await rollupResult {
                        if let ps = shocks.priceShocks {
                            priceMoves = CommandCompute.MoveSummary(
                                total: ps.total,
                                up: ps.up,
                                down: ps.down
                            )
                        } else {
                            priceMoves = .zero
                        }
                    } else {
                        priceMoves = .zero
                    }

                    // Margin moves: real dish-cost deltas over the 7-day / 5% window
                    // via MarginDeltasRepository (port of lib/marginDeltas.ts). Degrade
                    // to zero on query error, mirroring the priceMoves posture above.
                    let marginMoves: CommandCompute.MoveSummary = (try? await marginResult) ?? .zero

                    let s = CommandCompute.summarize(
                        bundle: bundle,
                        locationId: locationId,
                        today: today,
                        priceMoves: priceMoves,
                        marginMoves: marginMoves
                    )
                    let a = CommandCompute.alertsFor(s)

                    await MainActor.run {
                        self?.summary = s
                        self?.alerts = a
                        self?.errorText = nil
                    }
                } catch {
                    await MainActor.run {
                        self?.errorText = "Fetch error: \(error.localizedDescription)"
                    }
                }

                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() { streamTask?.cancel() }

    // Web parity: lib/db.ts `todayISO()` uses `new Date().toISOString().slice(0,10)`,
    // which is UTC. We match that by fixing the formatter's timezone to UTC.
    private static let isoDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private static func todayISO() -> String {
        isoDateFormatter.string(from: Date())
    }
}

// MARK: - Root view

struct CommandView: View {
    @State private var vm: CommandViewModel
    private let writeDatabase: LariatWriteDatabase?

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase? = nil) {
        _vm = State(wrappedValue: CommandViewModel(database: database))
        self.writeDatabase = writeDatabase
    }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if let s = vm.summary {
                CommandContentView(summary: s, alerts: vm.alerts, writeDatabase: writeDatabase)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Command center")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

// MARK: - Content (8 signal-group tiles + alerts)

private struct CommandContentView: View {
    let summary: CommandSummary
    let alerts: [CommandAlert]
    let writeDatabase: LariatWriteDatabase?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Where the kitchen stands right now.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                // ── Signal-group tiles ─────────────────────────────────────────
                // Each tile carries a traffic-light dot derived from the Command
                // alerts for its domain (red = critical, amber = warning, green =
                // clear). The alerts section below lists the same signals in detail.
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220))], spacing: 16) {
                    salesTile
                    eightySixTile
                    inventoryTile
                    priceMovesTile
                    marginMovesTile
                    prepBoardTile
                    laborTile
                    foodSafetyTile
                    eventsTile
                    reservationsTile
                }
                .padding(.horizontal)

                // ── Alerts section ─────────────────────────────────────────────
                if !alerts.isEmpty {
                    AlertsSection(alerts: alerts)
                        .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
    }

    // MARK: Signal-group tiles (web-aligned labels/values)

    /// Traffic-light tone for a tile: red if any of its alert `sources` fired a
    /// critical, amber for a warning, else green (clear). Tiles with no alert
    /// source of their own pass `[]` and stay green.
    private func tone(_ sources: [String]) -> CommandTileTone {
        let relevant = alerts.filter { sources.contains($0.source) }
        if relevant.contains(where: { $0.severity == .red }) { return .red }
        if relevant.contains(where: { $0.severity == .amber }) { return .amber }
        return .ok
    }

    // 1. Sales — "Yesterday vs 7-day average"
    private var salesTile: some View {
        CommandTile(title: "Sales", sub: "Yesterday vs 7-day average", tone: tone(["sales-down"])) {
            TileLine(n: formatDollars(summary.sales.yesterdayNet), label: "net sales yesterday")
            TileLine(n: "\(summary.sales.orders)", label: "orders")
            TileLine(n: formatDollars(summary.sales.avg7Net), label: "7-day avg")
        }
    }

    // 2. 86 board — "Active items off the menu right now"
    private var eightySixTile: some View {
        CommandTile(title: "86 board", sub: "Active items off the menu right now", tone: tone(["eighty-six"])) {
            TileLine(n: "\(summary.eightySix)", label: "items 86'd")
        }
    }

    // 3. Inventory — "Latest count vs par"
    private var inventoryTile: some View {
        CommandTile(title: "Inventory", sub: "Latest count vs par", tone: tone(["inventory-low-par", "inventory-open-counts"])) {
            TileLine(n: "\(summary.inventory.lowPar)", label: "below par")
            TileLine(n: "\(summary.inventory.parTotal)", label: "tracked items")
            TileLine(n: "\(summary.inventory.openCounts)", label: "open counts")
        }
    }

    // 4. Price moves — "Vendor SKUs that moved 5%+ in 7 days"
    // priceMoves is threaded from ManagementRollupRepository.load() → PriceShockSummary.
    private var priceMovesTile: some View {
        CommandTile(title: "Price moves", sub: "Vendor SKUs that moved 5%+ in 7 days", tone: tone(["price-moves"])) {
            TileLine(n: "\(summary.priceMoves.up)", label: "up")
            TileLine(n: "\(summary.priceMoves.down)", label: "down")
            TileLine(n: "\(summary.priceMoves.total)", label: "total moves")
        }
    }

    // 5. Margin moves — "Dish costs that moved 5%+ in 7 days"
    // marginMoves is threaded from MarginDeltasRepository.summary() (port of
    // lib/marginDeltas.ts listMarginDeltas) → MoveSummary, same as priceMoves.
    private var marginMovesTile: some View {
        CommandTile(title: "Margin moves", sub: "Dish costs that moved 5%+ in 7 days", tone: tone(["margin-moves"])) {
            TileLine(n: "\(summary.marginMoves.up)", label: "up")
            TileLine(n: "\(summary.marginMoves.down)", label: "down")
            TileLine(n: "\(summary.marginMoves.total)", label: "total moves")
        }
    }

    // 6. Prep board — "Today's tasks across the line"
    private var prepBoardTile: some View {
        CommandTile(title: "Prep board", sub: "Today's tasks across the line", tone: tone(["prep-rush"])) {
            TileLine(n: "\(summary.prep.todo)", label: "to do")
            TileLine(n: "\(summary.prep.inProgress)", label: "in progress")
            TileLine(n: "\(summary.prep.rush)", label: "high or rush")
        }
    }

    // 7. Labor — "Breaks owed + cert expiry"
    private var laborTile: some View {
        Group {
            if let writeDatabase {
                NavigationLink {
                    PerformanceReviewsView(writeDB: writeDatabase)
                } label: {
                    laborTileContent
                }
                .buttonStyle(.plain)
            } else {
                laborTileContent
            }
        }
    }

    private var laborTileContent: some View {
        CommandTile(title: "Labor", sub: "Breaks owed + cert expiry · tap reviews to log", tone: tone(["open-breaks", "cert-expiring-30d", "cert-expired", "performance-reviews-none"])) {
            TileLine(n: "\(summary.labor.openBreaks)", label: "open breaks")
            TileLine(n: "\(summary.labor.performanceReviewsToday)", label: "reviews today")
            TileLine(n: "\(summary.labor.certExpiring30d)", label: "certs expiring 30d")
            TileLine(n: "\(summary.labor.certExpired)", label: "expired certs")
        }
    }

    // 8. Food safety — "Today's temp readings + active date marks"
    private var foodSafetyTile: some View {
        CommandTile(title: "Food safety", sub: "Today's temp readings + active date marks", tone: tone(["temp-breaches", "date-marks-expired", "date-marks-due-today", "cleaning-overdue", "cleaning-due-today", "probes-overdue", "probes-failed", "probes-due-soon"])) {
            TileLine(n: "\(summary.foodSafety.tempBreaches)", label: "temp out of range")
            TileLine(n: "\(summary.foodSafety.dateMarksExpired)", label: "expired marks")
            TileLine(n: "\(summary.foodSafety.cleaningOverdue)", label: "cleaning overdue")
        }
    }

    // 9. Events — "Booked events today" (data already in CommandSummary)
    private var eventsTile: some View {
        CommandTile(title: "Events", sub: "Booked events today", tone: tone([])) {
            TileLine(n: "\(summary.eventsToday)", label: "events")
            TileLine(n: "\(summary.eventsGuests)", label: "covers")
        }
    }

    // 10. Reservations — "Today's covers" (data already in CommandSummary)
    private var reservationsTile: some View {
        CommandTile(title: "Reservations", sub: "Today's covers", tone: tone(["reservations-to-seat", "reservation-no-shows"])) {
            TileLine(n: "\(summary.reservations.booked)", label: "booked")
            TileLine(n: "\(summary.reservations.seated)", label: "seated")
            TileLine(n: "\(summary.reservations.noShow)", label: "no-shows")
        }
    }
}

// MARK: - Alerts section

private struct AlertsSection: View {
    let alerts: [CommandAlert]

    private var redAlerts: [CommandAlert] { alerts.filter { $0.severity == .red } }
    private var amberAlerts: [CommandAlert] { alerts.filter { $0.severity == .amber } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Alerts")
                .font(.headline)

            if !redAlerts.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Critical")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.red)
                    ForEach(redAlerts, id: \.source) { alert in
                        AlertRow(alert: alert)
                    }
                }
            }

            if !redAlerts.isEmpty && !amberAlerts.isEmpty {
                Divider()
            }

            if !amberAlerts.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Warnings")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.orange)
                    ForEach(amberAlerts, id: \.source) { alert in
                        AlertRow(alert: alert)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct AlertRow: View {
    let alert: CommandAlert

    private var color: Color {
        switch alert.severity {
        case .red: return .red
        case .amber: return .orange
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(alert.message)
                .font(.caption)
                .foregroundStyle(.primary)
        }
    }
}

// MARK: - Tile sub-views

/// Per-tile traffic-light tone, derived from the Command alerts for that tile's
/// domain: red (a critical alert), amber (a warning), ok (no alert = green),
/// neutral (no dot — tiles with no alert domain of their own).
private enum CommandTileTone {
    case red, amber, ok, neutral
    var color: Color? {
        switch self {
        case .red: return .red
        case .amber: return .orange
        case .ok: return .green
        case .neutral: return nil
        }
    }
}

private struct CommandTile<Content: View>: View {
    let title: String
    let sub: String
    var tone: CommandTileTone = .neutral
    @ViewBuilder let lines: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if let c = tone.color {
                    Circle().fill(c).frame(width: 8, height: 8)
                        .accessibilityLabel(toneLabel)
                }
            }
            lines()
            Text(sub)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private var toneLabel: String {
        switch tone {
        case .red: return "critical"
        case .amber: return "warning"
        case .ok: return "ok"
        case .neutral: return ""
        }
    }
}

private struct TileLine: View {
    let n: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Text(n)
                .font(.system(.title3, design: .rounded))
                .bold()
                .monospacedDigit()
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
