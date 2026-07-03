import SwiftUI
import LariatDB
import LariatModel
import Observation

@Observable @MainActor final class TodayViewModel {
    var snapshot: TodayBoardSnapshot?
    var catalogError: String?
    var fetchError: String?
    private let poller = BoardPoller()
    private let database: LariatDatabase
    private let catalog: StationCatalog?

    init(database: LariatDatabase) {
        self.database = database
        do {
            self.catalog = try StationCatalog.load()
            self.catalogError = nil
        } catch {
            self.catalog = nil
            // Actionable degrade copy — point at the cache files the catalog
            // reads (stations.json / line_checks.json / recipes.json).
            let cacheDir = resolveCacheDirectory()
            self.catalogError = "Station catalog missing — check \(cacheDir)/stations.json, line_checks.json, recipes.json (\(error.localizedDescription))"
        }
    }

    func start() {
        guard let catalog else { return }
        let repo = TodayBoardRepository(database: database, catalog: catalog)
        poller.start(interval: .seconds(3)) { [weak self] in
            do {
                let snap = try await repo.load()
                self?.snapshot = snap
                self?.fetchError = nil
            } catch {
                self?.fetchError = "Could not load Today"
                throw error
            }
        }
    }

    func stop() { poller.stop() }
}

struct TodayView: View {
    @State private var vm: TodayViewModel
    var onOpenEightySix: () -> Void
    var onOpenKds: () -> Void
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let catalog: StationCatalog?

    init(
        database: LariatDatabase,
        writeDB: LariatWriteDatabase? = nil,
        catalog: StationCatalog? = nil,
        onOpenEightySix: @escaping () -> Void = {},
        onOpenKds: @escaping () -> Void = {}
    ) {
        _vm = State(wrappedValue: TodayViewModel(database: database))
        self.readDB = database
        self.writeDB = writeDB
        self.catalog = catalog
        self.onOpenEightySix = onOpenEightySix
        self.onOpenKds = onOpenKds
    }

    var body: some View {
        Group {
            if let catalogErr = vm.catalogError {
                TileDegrade(title: "Could not load Today", message: catalogErr, systemImage: "tray")
            } else if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load Today", message: err, systemImage: "externaldrive.badge.xmark")
            } else if let snap = vm.snapshot {
                todayContent(snap)
            } else {
                ProgressView("Loading Today…")
            }
        }
        .navigationTitle("Today")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }

    @ViewBuilder
    private func todayContent(_ snap: TodayBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                heroSection(snap)
                actionRow(onOpenEightySix: onOpenEightySix)
                stationSection(snap)
                stockMovesSection(snap)
                if !snap.openEightySixItems.isEmpty || !snap.cascadedRecipes.isEmpty {
                    eightySixSection(snap)
                }
            }
            .padding()
        }
        .navigationDestination(for: String.self) { stationId in
            if let writeDB, let catalog {
                StationChecklistView(
                    stationId: stationId,
                    readDB: readDB,
                    writeDB: writeDB,
                    catalog: catalog
                )
            }
        }
    }

    private func heroSection(_ snap: TodayBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Today · \(formatDateChip(snap.shiftDate))")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Text("Line now")
                    .font(.largeTitle.bold())
                Text("See what is ready, what is out, and where to jump next.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                statCard(value: "\(snap.readyCount)", label: "Ready")
                statCard(value: "\(snap.flaggedCount)", label: "Flagged")
                statCard(value: "\(snap.openEightySixItems.count)", label: "86 now")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private func actionRow(onOpenEightySix: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            // Web parity: /v2/today links this card to /v2/kds/punch.
            Button(action: onOpenKds) {
                actionCard(eyebrow: "Next", title: "Send to line")
            }
            .buttonStyle(.plain)
            Button(action: onOpenEightySix) {
                actionCard(eyebrow: "Watch", title: "86 right now")
            }
            .buttonStyle(.plain)
        }
    }

    private func actionCard(eyebrow: String, title: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow).font(.caption.weight(.heavy)).foregroundStyle(.secondary).textCase(.uppercase)
            Text(title).font(.headline)
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .padding(16)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    }

    private func stationSection(_ snap: TodayBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Open line").font(.title3.bold())
                Spacer()
                Text(stationCountLabel(snap.activeStations.count))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                ForEach(snap.activeStations, id: \.station.id) { row in
                    if writeDB != nil, catalog != nil {
                        NavigationLink(value: row.station.id) {
                            stationCard(row)
                        }
                        .buttonStyle(.plain)
                    } else {
                        stationCard(row)
                    }
                }
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    private func stationCard(_ row: StationWithProgress) -> some View {
        let tone = StationProgressLabels.tone(for: row.progress)
        return HStack {
            VStack(alignment: .leading, spacing: 6) {
                Text(row.station.name).font(.headline)
                Text(StationProgressLabels.label(for: row.progress))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(LariatTheme.color(for: tone))
            }
            Spacer(minLength: 8)
            Circle()
                .fill(LariatTheme.color(for: tone))
                .frame(width: 12, height: 12)
        }
        .frame(minHeight: 78)
        .padding(14)
        .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
    }

    private func stockMovesSection(_ snap: TodayBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Stock moves").font(.title3.bold())
                Spacer()
                Text("Latest").font(.caption).foregroundStyle(.secondary)
            }
            if snap.recentMoves.isEmpty {
                EmptyState(message: "No stock moves yet", systemImage: "shippingbox")
                    .padding(10)
                    .background(.background.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
            } else {
                ForEach(Array(snap.recentMoves.enumerated()), id: \.offset) { _, move in
                    HStack {
                        Text(move.item).font(.headline)
                        Spacer()
                        Text(stockMoveDetail(move))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .background(.background.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    private func eightySixSection(_ snap: TodayBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("86 right now").font(.title3.bold())
                Spacer()
                Text(openCountLabel(snap.openEightySixItems.count))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            FlowLayout(spacing: 8) {
                ForEach(Array(snap.openEightySixItems.enumerated()), id: \.offset) { _, item in
                    Text(item)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(Color.red.opacity(0.2), in: Capsule())
                }
                ForEach(snap.cascadedRecipes, id: \.slug) { recipe in
                    Text(recipe.name)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(Color.orange.opacity(0.18), in: Capsule())
                }
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }


    private func statCard(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.title.bold())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
        .padding(14)
        .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    }

    private func formatDateChip(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return iso }
        var comps = DateComponents()
        comps.year = parts[0]; comps.month = parts[1]; comps.day = parts[2]
        comps.timeZone = TimeZone(identifier: "UTC")
        let cal = Calendar(identifier: .gregorian)
        guard let date = cal.date(from: comps) else { return iso }
        let fmt = DateFormatter()
        fmt.timeZone = TimeZone(identifier: "UTC")
        fmt.dateFormat = "MMM d"
        return fmt.string(from: date)
    }

    private func stationCountLabel(_ count: Int) -> String {
        count == 1 ? "1 station" : "\(count) stations"
    }

    private func openCountLabel(_ count: Int) -> String {
        count == 1 ? "1 open" : "\(count) open"
    }

    private func stockMoveDetail(_ move: TodayStockMove) -> String {
        if let delta = move.delta, !delta.isEmpty {
            return "\(move.direction) \(delta)"
        }
        return move.direction
    }
}

extension StationWithProgress: Identifiable {
    public var id: String { station.id }
}

/// Simple wrapping chip row for 86 / cascade tags.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var frames: [CGRect] = []
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: maxWidth, height: y + rowHeight), frames)
    }
}
