import SwiftUI
import LariatDB
import LariatModel
import Observation

@Observable @MainActor final class TodayViewModel {
    var snapshot: TodayBoardSnapshot?
    var catalogError: String?
    var fetchError: String?
    private var streamTask: Task<Void, Never>?
    private let database: LariatDatabase
    private let catalog: StationCatalog?

    init(database: LariatDatabase) {
        self.database = database
        do {
            self.catalog = try StationCatalog.load()
            self.catalogError = nil
        } catch {
            self.catalog = nil
            self.catalogError = "Station data unavailable: \(error.localizedDescription)"
        }
    }

    func start() {
        guard let catalog else { return }
        streamTask?.cancel()
        let repo = TodayBoardRepository(database: database, catalog: catalog)
        streamTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let snap = try await repo.load()
                    self?.snapshot = snap
                    self?.fetchError = nil
                } catch {
                    self?.fetchError = "Fetch error: \(error.localizedDescription)"
                }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() { streamTask?.cancel() }
}

struct TodayView: View {
    @State private var vm: TodayViewModel
    @State private var selectedStation: StationWithProgress?

    init(database: LariatDatabase) {
        _vm = State(wrappedValue: TodayViewModel(database: database))
    }

    var body: some View {
        Group {
            if let catalogErr = vm.catalogError {
                TileDegrade(title: "Today unavailable", message: catalogErr, systemImage: "tray")
            } else if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Today unavailable", message: err, systemImage: "externaldrive.badge.xmark")
            } else if let snap = vm.snapshot {
                todayContent(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Today")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(item: $selectedStation) { row in
            stationDetail(row)
        }
    }

    @ViewBuilder
    private func todayContent(_ snap: TodayBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                heroSection(snap)
                actionRow
                stationSection(snap)
                stockMovesSection(snap)
                if !snap.openEightySixItems.isEmpty || !snap.cascadedRecipes.isEmpty {
                    eightySixSection(snap)
                }
            }
            .padding()
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

    private var actionRow: some View {
        HStack(spacing: 12) {
            stubActionCard(eyebrow: "Next", title: "Send to line")
            stubActionCard(eyebrow: "Watch", title: "86 right now")
        }
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
                    Button { selectedStation = row } label: {
                        stationCard(row)
                    }
                    .buttonStyle(.plain)
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
                    .foregroundStyle(toneColor(tone))
            }
            Spacer(minLength: 8)
            Circle()
                .fill(toneColor(tone))
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
                Text("No stock moves yet")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
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

    private func stationDetail(_ row: StationWithProgress) -> some View {
        NavigationStack {
            List {
                if let p = row.progress {
                    LabeledContent("Done", value: "\(p.done) of \(p.total)")
                    LabeledContent("Flagged", value: "\(p.flagged)")
                    LabeledContent("Signed off", value: p.signedOff ? "Yes" : "No")
                } else {
                    Text("No line check for this station")
                }
            }
            .navigationTitle(row.station.name)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { selectedStation = nil }
                }
            }
        }
        .presentationDetents([.medium])
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

    private func stubActionCard(eyebrow: String, title: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(eyebrow).font(.caption.weight(.heavy)).foregroundStyle(.secondary).textCase(.uppercase)
            Text(title).font(.headline)
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .padding(16)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
        .opacity(0.7)
    }

    private func toneColor(_ tone: StationProgressLabels.Tone) -> Color {
        switch tone {
        case .muted: return .secondary
        case .red: return .red
        case .green: return .green
        case .amber: return Color(red: 0.89, green: 0.69, blue: 0.29)
        }
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
