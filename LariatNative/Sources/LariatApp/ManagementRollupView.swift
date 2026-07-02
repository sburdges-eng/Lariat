import SwiftUI
import LariatDB
import LariatModel
import Observation

@Observable @MainActor final class ManagementRollupViewModel {
    var snapshot: RollupSnapshot?
    var errorText: String?
    private let poller = BoardPoller()
    private let database: LariatDatabase

    init(database: LariatDatabase) {
        self.database = database
    }

    func start() {
        let repo = ManagementRollupRepository(database: database)
        // Poll every 3 s — mirrors CommandViewModel/AnalyticsViewModel/CostingViewModel.
        // ValueObservation can't see cross-process writes from the web app, so we poll.
        poller.start(interval: .seconds(3)) { [weak self] in
            do {
                let s = try await repo.load()
                self?.snapshot = s
                self?.errorText = nil
            } catch {
                self?.errorText = "Fetch error: \(error.localizedDescription)"
                throw error
            }
        }
    }

    func stop() { poller.stop() }

    var readDatabase: LariatDatabase { database }
}

struct ManagementRollupView: View {
    @State private var vm: ManagementRollupViewModel
    private let writeDatabase: LariatWriteDatabase?

    init(database: LariatDatabase, writeDatabase: LariatWriteDatabase?) {
        _vm = State(wrappedValue: ManagementRollupViewModel(database: database))
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
            } else if let s = vm.snapshot {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220))], spacing: 16) {
                        // Tile 1 — Food cost vs. target (accounting variance)
                        // Per-tile traffic-light color mirrors the web rules via
                        // RollupTileColor (parity-tested in RollupTileColorTests).
                        if let v = s.variance {
                            Tile(
                                title: "Food cost vs. target",
                                value: v.variancePct.map { String(format: "%.2f%%", $0) } ?? "—",
                                // Mirror web: append "· as of <snapshot_at>" when present.
                                sub: varianceSubLine(v),
                                severity: RollupTileColor.variance(pct: v.variancePct)
                            )
                        } else {
                            TileDegrade(
                                title: "Food cost vs. target",
                                message: "no compute run yet",
                                systemImage: "chart.bar.xaxis"
                            )
                        }

                        // Tile 2 — Costing freshness (last ingest run)
                        if let ingest = s.lastCostingIngest {
                            Tile(
                                title: "Costing freshness",
                                value: formatAge(ingest.ageMinutes),
                                // "never ingested" only applies when no ingest record exists at all
                                // (the TileDegrade path below). A present-but-statusless record
                                // means status is unknown, not that it was never run.
                                sub: ingest.lastStatus.map { "last status: \($0)" } ?? "status unknown",
                                severity: RollupTileColor.ingest(ageMinutes: ingest.ageMinutes, status: ingest.lastStatus)
                            )
                        } else {
                            TileDegrade(
                                title: "Costing freshness",
                                message: "never ingested",
                                systemImage: "clock.badge.xmark"
                            )
                        }

                        // Tile 3 — Price shocks (7-day / 5% threshold)
                        if let shocks = s.priceShocks {
                            Tile(
                                title: "Price shocks",
                                value: "\(shocks.total)",
                                sub: shocks.total > 0
                                    ? "\(shocks.up) up · \(shocks.down) down · 7 days"
                                    : "no 5% moves in 7 days",
                                severity: RollupTileColor.warningCount(shocks.total)
                            )
                        } else {
                            TileDegrade(
                                title: "Price shocks",
                                message: "price moves unavailable",
                                systemImage: "arrow.up.arrow.down"
                            )
                        }

                        // Tile 4 — Depletion issues (always a count)
                        Tile(
                            title: "Depletion issues",
                            value: "\(s.depletionExceptionCount)",
                            sub: s.depletionExceptionCount > 0
                                ? "\(s.depletionExceptionCount) dish\(s.depletionExceptionCount == 1 ? "" : "es") need mapping"
                                : "sold dishes map cleanly",
                            severity: RollupTileColor.warningCount(s.depletionExceptionCount)
                        )

                        // Tile 5 — Menu items costed (dish coverage)
                        // DEFERRED (P1a): coverage sub-line lacks the web's "X unlinked ·
                        // Y no-components" breakdown because DishCoverageView doesn't carry
                        // those counts (model gap, deferred to a follow-up). For the same
                        // reason this tile stays muted (severity: nil) — the web
                        // coverageColor needs that unlinked/declared_only/partial breakdown.
                        if let c = s.coverage {
                            Tile(
                                title: "Menu items costed",
                                value: coverageValue(c),
                                sub: c.coveragePct.map { String(format: "%.1f%% costed", $0) },
                                severity: nil
                            )
                        } else {
                            TileDegrade(
                                title: "Menu items costed",
                                message: "no sales dishes on file",
                                systemImage: "fork.knife"
                            )
                        }

                        // Tile 6 — Pack-size changes unack'd (navigate to triage when writes available)
                        if let writeDatabase {
                            NavigationLink {
                                PackChangesView(readDB: vm.readDatabase, writeDB: writeDatabase)
                            } label: {
                                Tile(
                                    title: "Pack-size changes unack'd",
                                    value: "\(s.unacknowledgedPackSizeChanges)",
                                    sub: "tap to review and give OK",
                                    severity: RollupTileColor.packChange(s.unacknowledgedPackSizeChanges)
                                )
                            }
                            .buttonStyle(.plain)
                        } else {
                            Tile(
                                title: "Pack-size changes unack'd",
                                value: "\(s.unacknowledgedPackSizeChanges)",
                                sub: "acks need write access — check data folder",
                                severity: RollupTileColor.packChange(s.unacknowledgedPackSizeChanges)
                            )
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Management")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

// MARK: — Helpers

/// Format covered/total dish counts using Optional chaining (idiomatic Swift over force-unwrap).
private func coverageValue(_ c: DishCoverageView) -> String {
    guard let covered = c.coveredDishes, let total = c.totalDishes else { return "—" }
    return "\(covered)/\(total)"
}

/// Build the variance tile sub-line, mirroring the web's "· as of <snapshot_at>" suffix.
private func varianceSubLine(_ v: AccountingVarianceView) -> String {
    var line = "theoretical \(formatDollars(v.theoreticalCogs)) vs actual \(formatDollars(v.actualCogs))"
    if let snapshot = v.snapshotAt {
        line += " · as of \(snapshot.prefix(10))"
    }
    return line
}

/// Format minutes into a human-readable age string matching the web's formatAge().
private func formatAge(_ ageMinutes: Int?) -> String {
    guard let age = ageMinutes else { return "no runs on record" }
    if age < 60 { return "\(age) min ago" }
    if age < 1440 { return "\(age / 60) h ago" }
    return "\(age / 1440) d ago"
}

// MARK: — Sub-views

private struct Tile: View {
    let title: String
    let value: String
    var sub: String?
    /// Traffic-light severity (nil == muted / no signal), computed by
    /// `RollupTileColor` to mirror the web `app/management/page.jsx` colors.
    var severity: ThresholdColor?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Self.indicatorColor(severity))
                    .frame(width: 8, height: 8)
                    .accessibilityLabel(Self.accessibilityLabel(severity))
                Text(title).font(.caption).foregroundStyle(.secondary)
            }
            Text(value).font(.system(.title, design: .rounded)).bold()
            if let sub { Text(sub).font(.caption2).foregroundStyle(.tertiary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    static func indicatorColor(_ severity: ThresholdColor?) -> Color {
        switch severity {
        case .red: return .red
        case .yellow: return .yellow
        case .green: return .green
        case nil: return .gray
        }
    }

    static func accessibilityLabel(_ severity: ThresholdColor?) -> String {
        switch severity {
        case .red: return "needs attention"
        case .yellow: return "watch"
        case .green: return "ok"
        case nil: return "no signal"
        }
    }
}
