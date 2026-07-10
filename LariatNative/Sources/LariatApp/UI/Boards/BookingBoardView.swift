import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Backs `foh.booking` — parity with `app/booking/page.jsx`: the live
/// pipeline counts, the five-week calendar, and the next-upcoming strip.
/// Read-only (the web page is a server component over lib/showsRepo.ts;
/// its PIN protection is middleware-only, matching the native reads-open
/// precedent).
@Observable @MainActor
final class BookingBoardViewModel {
    var snapshot: BookingBoardSnapshot?
    var fetchError: String?
    let poller = BoardPoller()

    private let database: LariatDatabase
    private let locationId: String

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = BookingRepository(database: database, locationId: locationId)
        do {
            snapshot = try await repo.loadBoard()
            fetchError = nil
        } catch {
            fetchError = "Could not load the booking calendar"
        }
    }
}

/// `foh.booking` — the booking calendar (web `/booking`). Pipeline stage
/// cards, next-show strip, five-weeks-ahead table.
struct BookingBoardView: View {
    @State private var vm: BookingBoardViewModel
    @State private var query = ""
    private let navigate: (String) -> Void

    init(database: LariatDatabase, navigate: @escaping (String) -> Void) {
        _vm = State(wrappedValue: BookingBoardViewModel(database: database))
        self.navigate = navigate
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load booking", message: err, systemImage: "externaldrive.badge.xmark")
            } else if let snap = vm.snapshot {
                boardContent(snap)
            } else {
                ProgressView("Loading the calendar…")
            }
        }
        .navigationTitle("Booking")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
    }

    private func boardContent(_ snap: BookingBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LaRiOS.Spacing.eight) {
                header(snap)
                pipelineSection(snap.pipelineCounts)
                calendarSection(snap.upcoming)
            }
            .padding(LaRiOS.Spacing.eight)
        }
        .searchable(text: $query, prompt: "Find an artist")
    }

    private func header(_ snap: BookingBoardSnapshot) -> some View {
        LaRiOSBoardHeader(
            eyebrow: "FOH",
            title: "The calendar",
            subtitle: "Five weeks ahead. Booking pipeline runs live below."
        ) {
            if let next = snap.next {
                // The web page links this strip into /shows/[id]/* — the
                // shows tier exists natively now, so route to the tonight
                // board (same ctx.navigate wiring as BarView/BarParView).
                Button {
                    navigate("shows.tonight")
                } label: {
                    HStack(spacing: 4) {
                        Text("Next show: \(next.bandName) · \(fmtDate(next.showDate))")
                        Image(systemName: "chevron.right")
                            .font(LaRiOS.Typography.xsmall)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.larios(.ghost))
                .accessibilityLabel("Next show: \(next.bandName). Open tonight's board.")
            }
        }
    }

    private func pipelineSection(_ counts: [String: Int]) -> some View {
        VStack(alignment: .leading, spacing: LaRiOS.Spacing.five) {
            LaRiOSSectionHeader(title: "Booking pipeline", subtitle: "Live count by stage")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: LaRiOS.Spacing.four)], spacing: LaRiOS.Spacing.four) {
                ForEach(Array(ShowPipelineCompute.knownStages.enumerated()), id: \.element) { i, stage in
                    LaRiOSMetricCard(
                        title: stage,
                        value: "\(counts[stage] ?? 0)",
                        tone: i >= 4 ? .warn : .neutral,
                        titlePrefix: "Stage \(i + 1)"
                    )
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private func calendarSection(_ rows: [BookingShowRow]) -> some View {
        VStack(alignment: .leading, spacing: LaRiOS.Spacing.five) {
            LaRiOSSectionHeader(title: "Five weeks ahead", subtitle: "\(rows.count) confirmed shows")
            let filtered = filteredRows(rows)
            if filtered.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    EmptyState(
                        message: rows.isEmpty ? "No shows on the books yet" : "No artists match “\(query)”",
                        systemImage: "music.mic"
                    )
                    if rows.isEmpty {
                        Text("Pull fresh after Lauren updates the booking sheet.")
                            .font(LaRiOS.Typography.xsmall)
                            .foregroundStyle(LaRiOS.Colors.textMuted)
                    }
                }
            } else {
                showTable(filtered)
            }
            Text("Cap / Sold / Sell-thru — ticketing data not yet wired (DICE integration deferred).")
                .font(LaRiOS.Typography.xsmall)
                .foregroundStyle(LaRiOS.Colors.textMuted)
        }
        .lariosPanel()
    }

    private func showTable(_ rows: [BookingShowRow]) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Date").frame(minWidth: 110, alignment: .leading)
                Text("Artist").frame(maxWidth: .infinity, alignment: .leading)
                Text("Price").frame(minWidth: 80, alignment: .trailing)
                Text("Door").frame(minWidth: 90, alignment: .leading)
            }
            .font(LaRiOS.Typography.smallStrong)
            .foregroundStyle(LaRiOS.Colors.textMuted)
            .padding(.vertical, 6)
            Rectangle()
                .fill(LaRiOS.Colors.hairline)
                .frame(height: 1)
            ForEach(rows) { row in
                HStack {
                    Text(fmtDate(row.showDate))
                        .font(LaRiOS.Typography.numberSmall)
                        .foregroundStyle(LaRiOS.Colors.textMuted)
                        .frame(minWidth: 110, alignment: .leading)
                    Text(row.bandName)
                        .font(LaRiOS.Typography.smallStrong)
                        .foregroundStyle(LaRiOS.Colors.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.price.map { formatDollars($0, decimals: 2) } ?? "—")
                        .font(LaRiOS.Typography.numberSmall)
                        .foregroundStyle(LaRiOS.Colors.text)
                        .frame(minWidth: 80, alignment: .trailing)
                    Text(row.doorTix ?? "—")
                        .font(LaRiOS.Typography.small)
                        .foregroundStyle(LaRiOS.Colors.textMuted)
                        .frame(minWidth: 90, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
                .lariosLedgerRow()
            }
        }
    }

    private func filteredRows(_ rows: [BookingShowRow]) -> [BookingShowRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.bandName.localizedCaseInsensitiveContains(q) }
    }

    /// "2026-05-01" → "Fri, May 1" (web fmtDate's weekday/month/day shape).
    private func fmtDate(_ iso: String) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US")
        out.dateFormat = "EEE, MMM d"
        return out.string(from: date)
    }
}
