import Foundation
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class CoolingViewModel {
    var snapshot: CoolingBoardSnapshot?
    var fetchError: String?
    var actionError: String?
    var isSaving = false
    var needsCorrectiveNote = false
    var showCookPicker = false
    var nowMs: Double = Date().timeIntervalSince1970 * 1000

    let cookStore: CookIdentityStore
    var staff: [StaffMember] = []
    var staffUnavailable = false

    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private let poller = BoardPoller()

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        cookStore: CookIdentityStore? = nil,
        locationId: String = LocationScope.resolve()
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.cookStore = cookStore ?? CookIdentityStore.shared
        self.locationId = locationId
        loadStaff()
    }

    func start() {
        poller.start(interval: .seconds(3)) { [weak self] in
            guard let self else { return }
            await self.refresh()
            self.nowMs = Date().timeIntervalSince1970 * 1000
            try BoardPoller.throwIfFailed(self.fetchError)
        }
    }

    func stop() { poller.stop() }

    func refresh() async {
        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        do {
            snapshot = try await repo.load(locationId: locationId)
            nowMs = Date().timeIntervalSince1970 * 1000
            fetchError = nil
        } catch {
            fetchError = "Could not load cooling log"
        }
    }

    /// Open a new cooling batch. `startReadingText` may be empty (cook probes at stage 1).
    func startBatch(item: String, station: String, startReadingText: String) async {
        guard !isSaving else { return }
        let trimmedItem = item.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedItem.isEmpty else {
            actionError = "Item name is required"
            return
        }
        var startReading: Double?
        let trimmedTemp = startReadingText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTemp.isEmpty {
            guard let v = Double(trimmedTemp), v.isFinite else {
                actionError = "Start temp must be a number in °F"
                return
            }
            startReading = v
        }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.start(
                input: CoolingStartInput(
                    item: trimmedItem,
                    startedAt: Self.isoFormatter.string(from: Date()),
                    startReadingF: startReading,
                    stationId: station.isEmpty ? nil : station,
                    cookId: cookStore.cookId,
                    shiftDate: snapshot?.date
                ),
                context: context
            )
            await refresh()
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Record a stage-1 or stage-2 reading for `id`.
    func logReading(id: Int64, readingText: String, note: String) async {
        guard !isSaving else { return }
        let trimmed = readingText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let reading = Double(trimmed), reading.isFinite else {
            actionError = "Enter a temperature in °F"
            return
        }
        guard ensureCookIdentity() else { return }

        isSaving = true
        actionError = nil
        defer { isSaving = false }

        let repo = CoolingRepository(readDB: readDB, writeDB: writeDB)
        let context = RegulatedWriteContext.nativeCook(cookId: cookStore.cookId, locationId: locationId)
        do {
            _ = try repo.logStage(
                input: CoolingStageInput(
                    id: id,
                    readingF: reading,
                    at: Self.isoFormatter.string(from: Date()),
                    correctiveAction: note.isEmpty ? nil : note,
                    cookId: cookStore.cookId
                ),
                context: context
            )
            needsCorrectiveNote = false
            await refresh()
        } catch let error as CoolingWriteError where error.needsCorrectiveAction {
            needsCorrectiveNote = true
            actionError = "\(WriteErrorMapper.message(for: error)) — enter a note and re-submit"
        } catch {
            actionError = WriteErrorMapper.message(for: error)
        }
    }

    /// Live countdown for a row, recomputed against `nowMs` (mirrors the web `openLive` tick).
    func scanEntry(for row: CoolingRow) -> CoolingScanEntry? {
        let live = CoolingCompute.scanOpenBatches([row], nowMs: nowMs)
        return live.first
    }

    private func ensureCookIdentity() -> Bool {
        if cookStore.cookId != nil { return true }
        showCookPicker = true
        return false
    }

    private func loadStaff() {
        do {
            staff = try StaffCatalog.load()
            staffUnavailable = staff.isEmpty
        } catch {
            staff = []
            staffUnavailable = true
        }
    }
}
