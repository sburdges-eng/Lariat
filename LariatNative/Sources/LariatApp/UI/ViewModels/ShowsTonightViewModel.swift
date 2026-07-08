import Foundation
import LariatDB
import LariatModel
import Observation

/// Tonight · Live view model — parity with `/shows/tonight` +
/// `GET /api/shows/tonight` (composed read-only snapshot) plus the
/// `POST /api/shows/[id]/capacity` override write and the upcoming-pipeline
/// strip (`upcomingShows` + `pipelineCounts` + the `pipelineStage` state
/// machine). Polls every 5 s (cross-process web writes are invisible to
/// GRDB ValueObservation).
@Observable @MainActor
final class ShowsTonightViewModel {
    var snapshot: ShowsRepository.TonightSnapshot?
    var upcoming: [ShowRow] = []
    var pipelineCounts: [PipelineStage: Int] = [:]
    var fetchError: String?
    var capacityText = ""
    var capacityError: String?

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase?
    private let gateModel: ShowsGateModel
    private let locationId: String
    let poller = BoardPoller()

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase?,
        gateModel: ShowsGateModel,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.gateModel = gateModel
        self.locationId = locationId
    }

    var today: String { ShiftDate.todayISO() }

    func start() {
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = ShowsRepository(readDB: readDB, locationId: locationId)
        do {
            snapshot = try await repo.tonightSnapshot(date: today)
            upcoming = try await repo.upcomingShows(today: today, weeks: 5)
            pipelineCounts = try await repo.pipelineCounts(today: today, weeks: 52)
            fetchError = nil
        } catch {
            fetchError = "Could not load tonight's board"
        }
    }

    /// Pipeline stage for one upcoming row (state-machine parity).
    func stage(for show: ShowRow) -> PipelineStage {
        ShowStatusCompute.pipelineStage(show.status, showIsPast: show.showDate < today)
    }

    func doorsLabel() -> String? {
        guard let status = snapshot?.showStatus else { return nil }
        return ShowsTonightCompute.pickShowTime(status, key: .doors)
    }

    // ── Capacity override write ─────────────────────────────────────────

    func setCapacity() {
        submitCapacity(rawText: capacityText)
    }

    func clearCapacity() {
        submitCapacity(rawText: nil)
    }

    private func submitCapacity(rawText: String?) {
        capacityError = nil
        guard let show = snapshot?.show else {
            capacityError = "No show tonight."
            return
        }
        guard let writeDB else {
            capacityError = "Write database unavailable."
            return
        }
        let capacity: Double?
        if let rawText {
            let trimmed = rawText.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                capacity = nil
            } else if let n = Double(trimmed) {
                capacity = n
            } else {
                capacityError = "capacity must be a finite number or null"
                return
            }
        } else {
            capacity = nil
        }
        do {
            let user = try gateModel.actorForWrite()
            let repo = ShowsRepository(readDB: readDB, locationId: locationId)
            _ = try repo.setCapacityOverride(
                showId: show.id,
                capacity: capacity,
                writeDB: writeDB,
                actorCookId: user.map { String($0.id) }
            )
            capacityText = ""
            Task { await refresh() }
        } catch {
            capacityError = WriteErrorMapper.message(for: error)
        }
    }
}
