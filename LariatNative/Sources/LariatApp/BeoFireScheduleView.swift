import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Backs `beo.fireSchedule` — the per-station "tonight" rollup
/// (`GET /api/beo/fire-schedule` date path). PUBLIC on web (wall-iPad, no
/// PIN) — pure read natively.
@Observable @MainActor
final class BeoFireScheduleViewModel {
    private(set) var payload: BeoFireScheduleCompute.FireSchedulePayload?
    private(set) var loaded = false
    var fetchError: String?
    var date: Date = Date() {
        didSet { Task { await refresh() } }
    }

    private let repo: BeoFireScheduleRepository
    private let locationId: String

    init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.repo = BeoFireScheduleRepository(database: database)
        self.locationId = locationId
    }

    var dateISO: String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        return df.string(from: date)
    }

    func refresh() async {
        do {
            payload = try await repo.schedule(date: dateISO, locationId: locationId)
            fetchError = nil
        } catch {
            fetchError = "Could not load the fire schedule."
        }
        loaded = true
    }
}

/// Native port of the fire-schedule rollup (spec T7/T8 in
/// docs/superpowers/specs/2026-05-04-beo-fire-times.md): stations →
/// courses → bound lines, age-colored green/yellow/red around each course's
/// fire time (30-minute yellow threshold, KDS color convention).
struct BeoFireScheduleView: View {
    @State private var vm: BeoFireScheduleViewModel
    /// Re-renders the age buckets each minute without refetching.
    @State private var now = Date()
    private let clock = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    init(database: LariatDatabase) {
        _vm = State(wrappedValue: BeoFireScheduleViewModel(database: database))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError {
                TileDegrade(title: "Could not load fire schedule", message: err, systemImage: "flame")
            } else if !vm.loaded {
                ProgressView("Loading fire schedule…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Fire schedule")
        .task { await vm.refresh() }
        .onReceive(clock) { now = $0 }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                DatePicker("Service date", selection: $vm.date, displayedComponents: .date)
                    .frame(maxWidth: 260)

                if let payload = vm.payload, !payload.stations.isEmpty {
                    ForEach(payload.stations) { station in
                        BeoFireStationSection(station: station, now: now)
                    }
                } else {
                    EmptyState(
                        message: "No fire times for \(vm.dateISO). Courses set on the BEO board appear here.",
                        systemImage: "flame"
                    )
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
