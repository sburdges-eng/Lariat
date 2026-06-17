import SwiftUI
import LariatDB
import LariatModel
import Observation

@Observable @MainActor
final class PerformanceReviewsViewModel {
    var reviews: [PerformanceReviewRow] = []
    var errorText: String?
    var submitError: String?
    var showPinSheet = false
    var showForm = false

    var cookName = ""
    var reviewDate = ShiftDate.todayISO()
    var punctuality = 3
    var technique = 3
    var speed = 3
    var notes = ""
    var reviewerName = ""

    private let writeDB: LariatWriteDatabase
    private let pinStore: PinSessionStore
    private let locationId: String
    private var pollTask: Task<Void, Never>?

    init(writeDB: LariatWriteDatabase, pinStore: PinSessionStore, locationId: String = LocationScope.resolve()) {
        self.writeDB = writeDB
        self.pinStore = pinStore
        self.locationId = locationId
    }

    var writeDatabase: LariatWriteDatabase { writeDB }

    func start() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() { pollTask?.cancel() }

    func refresh() async {
        let repo = PerformanceReviewsRepository(database: writeDB)
        do {
            reviews = try repo.list(locationId: locationId)
            errorText = nil
        } catch {
            errorText = WriteErrorMapper.message(for: error)
        }
    }

    func requestSubmit() {
        submitError = nil
        do {
            let gateOn = try writeDB.pool.read { db in try PinVerifier().gateConfigured(db: db) }
            guard gateOn else {
                submitError = "PIN not set up — add a manager PIN in web Settings"
                return
            }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
            return
        }
        if pinStore.activeUser != nil {
            performSubmit()
        } else {
            showPinSheet = true
        }
    }

    func performSubmit() {
        submitError = nil
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            let context = RegulatedWriteContext.nativeMac(pinUser: user)
            let repo = PerformanceReviewsRepository(database: writeDB)
            _ = try repo.create(
                input: PerformanceReviewCreateInput(
                    cookName: cookName,
                    cookUuid: nil,
                    reviewDate: reviewDate,
                    punctualityScore: punctuality,
                    techniqueScore: technique,
                    speedScore: speed,
                    notes: notes,
                    reviewerName: reviewerName,
                    locationId: locationId
                ),
                auditContext: context
            )
            cookName = ""
            notes = ""
            showForm = false
            Task { await refresh() }
        } catch {
            submitError = WriteErrorMapper.message(for: error)
        }
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        if showForm {
            performSubmit()
        }
    }

    func classification(for row: PerformanceReviewRow) -> ReviewClassification {
        PerformanceReviewCompute.classifyReview(
            PerformanceReviewScores(
                punctualityScore: row.punctualityScore ?? 0,
                techniqueScore: row.techniqueScore ?? 0,
                speedScore: row.speedScore ?? 0
            )
        )
    }
}

struct PerformanceReviewsView: View {
    @State private var vm: PerformanceReviewsViewModel

    init(writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: PerformanceReviewsViewModel(writeDB: writeDB, pinStore: PinSessionStore.shared))
    }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(title: "Performance reviews", message: err, systemImage: "exclamationmark.triangle")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("\(vm.reviews.count) on file").font(.subheadline).foregroundStyle(.secondary)
                        Spacer()
                        Button("Log review") { vm.showForm = true }
                    }

                    if vm.reviews.isEmpty {
                        ContentUnavailableView("No reviews yet", systemImage: "person.text.rectangle")
                    } else {
                        List(vm.reviews) { row in
                            let tag = vm.classification(for: row)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(row.cookName).font(.headline)
                                    Spacer()
                                    Text(tag.label)
                                        .font(.caption)
                                        .foregroundStyle(color(for: tag.status))
                                }
                                Text(row.reviewDate).font(.caption).foregroundStyle(.secondary)
                                Text("On time \(row.punctualityScore ?? 0) · Technique \(row.techniqueScore ?? 0) · Speed \(row.speedScore ?? 0)")
                                    .font(.caption2)
                                if let notes = row.notes, !notes.isEmpty {
                                    Text(notes).font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    if let submitError = vm.submitError {
                        Text(submitError).font(.caption).foregroundStyle(.red)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Performance reviews")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showForm) {
            NavigationStack {
                Form {
                    TextField("Cook name", text: $vm.cookName)
                    TextField("Review date", text: $vm.reviewDate)
                    Stepper("On time: \(vm.punctuality)", value: $vm.punctuality, in: 1...5)
                    Stepper("Technique: \(vm.technique)", value: $vm.technique, in: 1...5)
                    Stepper("Speed: \(vm.speed)", value: $vm.speed, in: 1...5)
                    TextField("Reviewer name", text: $vm.reviewerName)
                    TextField("Notes", text: $vm.notes, axis: .vertical)
                        .lineLimit(3...6)
                }
                .navigationTitle("Log review")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { vm.showForm = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { vm.requestSubmit() }
                    }
                }
            }
            .frame(minWidth: 360, minHeight: 420)
        }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
    }

    private func color(for status: ReviewStatus) -> Color {
        switch status {
        case .green: return .green
        case .amber: return .orange
        case .red: return .red
        case .gray: return .secondary
        }
    }
}
