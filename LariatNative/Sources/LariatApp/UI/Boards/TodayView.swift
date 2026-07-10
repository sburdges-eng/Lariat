import SwiftUI
import LariatDB
import LariatModel
import Observation

@Observable @MainActor final class TodayViewModel {
    var snapshot: TodayBoardSnapshot?
    var catalogError: String?
    var fetchError: String?
    let poller = BoardPoller()
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
                LaRiOSLoadingView(message: "Loading line")
            }
        }
        .navigationTitle("Today")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
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
            .frame(maxWidth: 1180, alignment: .leading)
            .padding(LaRiOS.Spacing.twelve)
        }
        .scrollContentBackground(.hidden)
        .background(LaRiOS.Colors.background)
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
            LaRiOSBoardHeader(
                eyebrow: "Today \(formatDateChip(snap.shiftDate))",
                title: "Line now",
                subtitle: "Ready, out, and next up."
            ) {
                LaRiOSChip(text: "Local DB", tone: .ok)
            }
            HStack(spacing: 10) {
                statCard(value: "\(snap.readyCount)", label: "Ready", tone: .ok)
                statCard(value: "\(snap.flaggedCount)", label: "Flagged", tone: snap.flaggedCount > 0 ? .warn : .neutral)
                statCard(value: "\(snap.openEightySixItems.count)", label: "86 now", tone: snap.openEightySixItems.isEmpty ? .neutral : .bad)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .lariosPanel(padding: LaRiOS.Spacing.eight, fill: LaRiOS.Colors.panelRaised)
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
            Text(eyebrow.uppercased())
                .font(LaRiOS.Typography.eyebrow)
                .foregroundStyle(LaRiOS.Colors.textMuted)
            Text(title)
                .font(LaRiOS.Typography.titleSmall)
                .foregroundStyle(LaRiOS.Colors.text)
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .padding(LaRiOS.Spacing.six)
        .background(LaRiOS.Colors.panelRaised, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
        .overlay {
            RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                .stroke(LaRiOS.Colors.hairline, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(eyebrow): \(title)")
    }

    private func stationSection(_ snap: TodayBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                LaRiOSSectionHeader(title: "Open line", subtitle: stationCountLabel(snap.activeStations.count), tone: .accent)
                Spacer()
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
        .lariosPanel(fill: LaRiOS.Colors.panel)
    }

    private func stationCard(_ row: StationWithProgress) -> some View {
        let tone = StationProgressLabels.tone(for: row.progress)
        return HStack {
            VStack(alignment: .leading, spacing: 6) {
                Text(row.station.name)
                    .font(LaRiOS.Typography.bodyStrong)
                    .foregroundStyle(LaRiOS.Colors.text)
                Text(StationProgressLabels.label(for: row.progress))
                    .font(LaRiOS.Typography.smallStrong)
                    .foregroundStyle(LariatTheme.color(for: tone))
            }
            Spacer(minLength: 8)
            Circle()
                .fill(LariatTheme.color(for: tone))
                .frame(width: 12, height: 12)
        }
        .frame(minHeight: 78)
        .padding(LaRiOS.Spacing.six)
        .background(LaRiOS.Colors.panelRaised, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
        .overlay {
            RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                .stroke(LaRiOS.Colors.hairline, lineWidth: 1)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.station.name), \(StationProgressLabels.label(for: row.progress))")
    }

    private func stockMovesSection(_ snap: TodayBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                LaRiOSSectionHeader(title: "Stock moves", subtitle: "Latest", tone: .info)
                Spacer()
            }
            if snap.recentMoves.isEmpty {
                EmptyState(message: "No stock moves yet", systemImage: "shippingbox")
                    .padding(10)
                    .background(LaRiOS.Colors.panelRaised, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
            } else {
                ForEach(Array(snap.recentMoves.enumerated()), id: \.offset) { _, move in
                    HStack {
                        Text(move.item)
                            .font(LaRiOS.Typography.bodyStrong)
                            .foregroundStyle(LaRiOS.Colors.text)
                        Spacer()
                        Text(stockMoveDetail(move))
                            .font(LaRiOS.Typography.xsmall)
                            .foregroundStyle(LaRiOS.Colors.textMuted)
                    }
                    .padding(LaRiOS.Spacing.five)
                    .background(LaRiOS.Colors.panelRaised, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .lariosPanel(fill: LaRiOS.Colors.panel)
    }

    private func eightySixSection(_ snap: TodayBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                LaRiOSSectionHeader(title: "86 right now", subtitle: openCountLabel(snap.openEightySixItems.count), tone: .bad)
                Spacer()
            }
            FlowLayout(spacing: 8) {
                ForEach(Array(snap.openEightySixItems.enumerated()), id: \.offset) { _, item in
                    LaRiOSChip(text: item, tone: .bad)
                        .accessibilityLabel("\(item), 86’d")
                }
                ForEach(snap.cascadedRecipes, id: \.slug) { recipe in
                    LaRiOSChip(text: recipe.name, tone: .warn)
                        .accessibilityLabel("\(recipe.name), affected — via \(recipe.via)")
                }
            }
        }
        .lariosPanel(fill: LaRiOS.Colors.panel)
    }


    private func statCard(value: String, label: String, tone: LaRiOSTone) -> some View {
        LaRiOSMetricCard(title: label, value: value, tone: tone)
            .frame(minHeight: 92)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label)")
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
