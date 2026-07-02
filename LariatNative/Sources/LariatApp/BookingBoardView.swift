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
    private let poller = BoardPoller()

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

    init(database: LariatDatabase) {
        _vm = State(wrappedValue: BookingBoardViewModel(database: database))
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
        .onDisappear { vm.stop() }
    }

    private func boardContent(_ snap: BookingBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header(snap)
                pipelineSection(snap.pipelineCounts)
                calendarSection(snap.upcoming)
            }
            .padding()
        }
        .searchable(text: $query, prompt: "Find an artist")
    }

    private func header(_ snap: BookingBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("The calendar").font(.largeTitle.bold())
            Text("Five weeks ahead — the booking pipeline runs live below.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let next = snap.next {
                // The web page links this strip into /shows/[id]/* —
                // those surfaces are the shows wave; text-only here.
                Text("Next show: \(next.bandName) · \(fmtDate(next.showDate))")
                    .font(.subheadline.bold())
                    .foregroundStyle(LariatTheme.warn)
            }
        }
    }

    private func pipelineSection(_ counts: [String: Int]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Booking pipeline").font(.headline)
            Text("live count by stage").font(.caption).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                ForEach(Array(ShowPipelineCompute.knownStages.enumerated()), id: \.element) { i, stage in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("STAGE \(i + 1)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("\(counts[stage] ?? 0)")
                            .font(.system(size: 30, weight: .semibold, design: .serif))
                        Text(stage).font(.subheadline.bold())
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(
                        i >= 4 ? AnyShapeStyle(LariatTheme.amber.opacity(0.18)) : AnyShapeStyle(.quaternary),
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                }
            }
        }
    }

    private func calendarSection(_ rows: [BookingShowRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Five weeks ahead").font(.headline)
            Text("\(rows.count) confirmed shows").font(.caption).foregroundStyle(.secondary)
            let filtered = filteredRows(rows)
            if filtered.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    EmptyState(
                        message: rows.isEmpty ? "No shows on the books yet" : "No artists match “\(query)”",
                        systemImage: "music.mic"
                    )
                    if rows.isEmpty {
                        Text("Pull fresh after Lauren updates the booking sheet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                showTable(filtered)
            }
            Text("Cap / Sold / Sell-thru — ticketing data not yet wired (DICE integration deferred).")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding()
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func showTable(_ rows: [BookingShowRow]) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Date").frame(width: 110, alignment: .leading)
                Text("Artist").frame(maxWidth: .infinity, alignment: .leading)
                Text("Price").frame(width: 80, alignment: .trailing)
                Text("Door").frame(width: 90, alignment: .leading)
            }
            .font(.caption.bold())
            .foregroundStyle(.secondary)
            .padding(.vertical, 6)
            Divider()
            ForEach(rows) { row in
                HStack {
                    Text(fmtDate(row.showDate))
                        .font(.caption.monospaced())
                        .frame(width: 110, alignment: .leading)
                    Text(row.bandName)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.price.map { formatDollars($0, decimals: 2) } ?? "—")
                        .font(.caption.monospaced())
                        .frame(width: 80, alignment: .trailing)
                    Text(row.doorTix ?? "—")
                        .font(.caption)
                        .frame(width: 90, alignment: .leading)
                }
                .padding(.vertical, 6)
                Divider()
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
