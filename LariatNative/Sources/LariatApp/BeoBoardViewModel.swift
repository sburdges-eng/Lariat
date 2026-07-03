import Foundation
import LariatDB
import LariatModel
import Observation

/// Backs `beo.board` — native port of `app/beo/BeoBoard.tsx` (+ CoursePanel,
/// EventOrderGuidePanel, EventPrepPanel, EventFirePanel, PrepHistoryPanel).
/// Reads are open; every write is PIN-gated via the manager-PIN session and
/// flows through the `/api/beo`-parity repositories (`actor_source =
/// native_mac`). The web's client-share affordance is an edge blocker and has
/// no native counterpart; beo_prep_tasks have API parity in the repository
/// but (like the current web board) no UI.
@Observable @MainActor
final class BeoBoardViewModel {
    enum Tab: String, CaseIterable, Identifiable {
        case sheet = "Sheet"
        case orderGuide = "Order guide"
        case prep = "Prep"
        case fire = "Fire"
        var id: String { rawValue }
    }

    private(set) var snapshot: BeoSnapshot?
    private(set) var loaded = false
    private(set) var courses: [BeoCourseRow] = []
    private(set) var pastPrep: [BeoPrepHistoryMatch] = []
    private(set) var cascade: BeoCascadeOutcome?
    private(set) var cascadeLoading = false
    private(set) var fire: BeoFireScheduleCompute.FireSchedulePayload?
    private(set) var fireLoading = false
    private(set) var menu: [CateringMenuItem]

    var fetchError: String?
    var errorMessage: String?
    var isSaving = false
    var showPinSheet = false
    /// Bumped when a pending write is discarded (PIN sheet cancelled) so the
    /// sheet tab's `CommitTextField`s are rebuilt and re-adopt the persisted
    /// row values instead of keeping the unsaved text.
    private(set) var editorGeneration = 0

    var selectedEventId: Int64? {
        didSet { if oldValue != selectedEventId { onEventChanged() } }
    }
    /// Reset to Sheet whenever the open event changes (web behavior).
    var tab: Tab = .sheet {
        didSet { if oldValue != tab { Task { await loadTabData() } } }
    }

    var eventQuery = ""
    var menuFilter = ""

    // Add-party form (web `+ New party`).
    var newTitle = ""
    var newDate = ""
    var newTime = ""
    var newContact = ""
    var newGuests = ""
    var newNotes = ""

    // Add-course form (web CoursePanel).
    var newCourseLabel = ""
    var newCourseTime = ""   // local wall-clock "HH:MM"

    let pinStore: PinSessionStore
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let locationId: String
    private var pendingAction: (() -> Void)?
    /// Distinguishes verify-then-dismiss from a plain cancel in `onDismiss`.
    private var pinVerifiedWhileSheetUp = false

    private let boardRepo: BeoBoardRepository
    private let coursesRepo: BeoCoursesRepository
    private let cascadeRepo: BeoCascadeRepository
    private let fireRepo: BeoFireScheduleRepository
    private let prepHistoryRepo: BeoPrepHistoryRepository

    init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        pinStore: PinSessionStore? = nil,
        locationId: String = LocationScope.resolve(),
        menu: [CateringMenuItem]? = nil
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.pinStore = pinStore ?? PinSessionStore.shared
        self.locationId = locationId
        self.menu = menu ?? CateringMenuCatalog.load()
        self.boardRepo = BeoBoardRepository(readDB: readDB, writeDB: writeDB)
        self.coursesRepo = BeoCoursesRepository(readDB: readDB, writeDB: writeDB)
        self.cascadeRepo = BeoCascadeRepository(database: readDB)
        self.fireRepo = BeoFireScheduleRepository(database: readDB)
        self.prepHistoryRepo = BeoPrepHistoryRepository(database: readDB)
    }

    var writeDatabase: LariatWriteDatabase { writeDB }

    // ── derived state ────────────────────────────────────────────────────

    var events: [BeoEventRow] { snapshot?.events ?? [] }

    var filteredEvents: [BeoEventRow] {
        let q = eventQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return events }
        return events.filter {
            $0.title.lowercased().contains(q)
                || ($0.eventDate ?? "").lowercased().contains(q)
                || ($0.contactName ?? "").lowercased().contains(q)
        }
    }

    var selectedEvent: BeoEventRow? {
        events.first { $0.id == selectedEventId }
    }

    /// Open event's lines, in GET order (event_id, sort_order, id).
    var lineItems: [BeoLineItemRow] {
        guard let selectedEventId else { return [] }
        return (snapshot?.lineItems ?? []).filter { $0.eventId == selectedEventId }
    }

    var totals: BeoWorksheetCompute.Totals {
        BeoWorksheetCompute.totals(
            lines: lineItems.map { .init(unitCost: $0.unitCost, quantity: $0.quantity) },
            taxRate: selectedEvent?.taxRate,
            serviceFeePct: selectedEvent?.serviceFeePct
        )
    }

    var filteredMenu: [(category: String, items: [CateringMenuItem])] {
        groupByCategory(menu, filter: menuFilter)
    }

    /// Full menu grouped by category, ignoring the rail filter — backs the
    /// prep-sheet "Add menu item" dropdown.
    var menuGroups: [(category: String, items: [CateringMenuItem])] {
        groupByCategory(menu, filter: "")
    }

    private func groupByCategory(
        _ items: [CateringMenuItem], filter: String
    ) -> [(category: String, items: [CateringMenuItem])] {
        let q = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var order: [String] = []
        var byCategory: [String: [CateringMenuItem]] = [:]
        for item in items {
            if !q.isEmpty,
               !item.name.lowercased().contains(q),
               !item.category.lowercased().contains(q) { continue }
            if byCategory[item.category] == nil { order.append(item.category) }
            byCategory[item.category, default: []].append(item)
        }
        return order.map { (category: $0, items: byCategory[$0] ?? []) }
    }

    func courseLabel(for courseId: Int64?) -> String? {
        guard let courseId else { return nil }
        return courses.first { $0.id == courseId }?.courseLabel
    }

    // ── loads ────────────────────────────────────────────────────────────

    func refresh() async {
        do {
            snapshot = try await boardRepo.load(locationId: locationId)
            fetchError = nil
            if selectedEventId == nil, let first = snapshot?.events.first {
                selectedEventId = first.id
            }
        } catch {
            fetchError = "Couldn't load — refresh the page"
        }
        loaded = true
        await loadCourses()
        await loadPastPrep()
        await loadTabData()
    }

    private func onEventChanged() {
        tab = .sheet
        cascade = nil
        fire = nil
        Task {
            await loadCourses()
            await loadPastPrep()
        }
    }

    private func loadCourses() async {
        guard let selectedEventId else {
            courses = []
            return
        }
        // Silent on failure — the UI shows an empty course list (web parity).
        courses = (try? coursesRepo.list(eventId: selectedEventId, locationId: locationId)) ?? []
    }

    private func loadPastPrep() async {
        let items = lineItems.map(\.itemName)
        guard !items.isEmpty else {
            pastPrep = []
            return
        }
        // PrepHistoryPanel passes limit=3.
        pastPrep = (try? await prepHistoryRepo.itemPrepHistory(
            items: items, limit: 3, locationId: locationId)) ?? []
    }

    func loadTabData() async {
        switch tab {
        case .sheet:
            break
        case .orderGuide, .prep:
            await loadCascade()
        case .fire:
            await loadFire()
        }
    }

    private func loadCascade() async {
        guard let selectedEventId, cascade?.eventId != selectedEventId else { return }
        cascadeLoading = true
        defer { cascadeLoading = false }
        cascade = try? await cascadeRepo.cascade(eventId: selectedEventId, locationId: locationId)
    }

    private func loadFire() async {
        guard let selectedEventId else { return }
        fireLoading = true
        defer { fireLoading = false }
        fire = try? await fireRepo.schedule(eventId: selectedEventId, locationId: locationId)
    }

    // ── PIN-gated write requests ─────────────────────────────────────────

    func requestAddParty() {
        errorMessage = nil
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            errorMessage = "Party needs a name"
            return
        }
        let input = BeoEventInput(
            title: title,
            eventDate: newDate.isEmpty ? nil : newDate,
            eventTime: newTime.isEmpty ? nil : newTime,
            contactName: newContact.isEmpty ? nil : newContact,
            guestCount: Int(newGuests),
            notes: newNotes.isEmpty ? nil : newNotes
        )
        gate { [weak self] in
            self?.withSession { context in
                let id = try self?.boardRepo.createEvent(input, locationId: self?.locationId ?? "default", context: context)
                self?.newTitle = ""; self?.newDate = ""; self?.newTime = ""
                self?.newContact = ""; self?.newGuests = ""; self?.newNotes = ""
                if let id { self?.selectedEventId = id }
            }
        }
    }

    func requestUpdateEvent(_ patch: BeoEventPatch) {
        errorMessage = nil
        guard let id = selectedEventId else { return }
        gate { [weak self] in
            self?.withSession { context in
                try self?.boardRepo.updateEvent(
                    id: id, patch: patch, locationId: self?.locationId ?? "default", context: context)
            }
        }
    }

    func requestKillParty() {
        errorMessage = nil
        guard let id = selectedEventId else { return }
        gate { [weak self] in
            self?.withSession { context in
                try self?.boardRepo.deleteEvent(
                    id: id, locationId: self?.locationId ?? "default", context: context)
                self?.selectedEventId = nil
            }
        }
    }

    func requestAddLine(_ item: CateringMenuItem) {
        errorMessage = nil
        guard let eventId = selectedEventId else { return }
        // Pricing + related prep-sheet fields come straight from the menu
        // catalog (cost from catering_menu.json; prep/plating/order from the
        // BEO prep-defaults sidecar) so a pick lands a fully-populated line —
        // empty strings for items with no history leave those fields blank.
        let input = BeoLineInput(
            eventId: eventId, itemName: item.name, category: item.category,
            unitCost: item.cost, quantity: 1,
            prepNotes: item.prepNotes.isEmpty ? nil : item.prepNotes,
            secondaryPrepNotes: item.secondaryPrepNotes.isEmpty ? nil : item.secondaryPrepNotes,
            orderItemsNotes: item.orderItemsNotes.isEmpty ? nil : item.orderItemsNotes)
        gate { [weak self] in
            self?.withSession { context in
                try self?.boardRepo.addLine(
                    input, locationId: self?.locationId ?? "default", context: context)
            }
        }
    }

    func requestUpdateLine(id: Int64, patch: BeoLinePatch) {
        errorMessage = nil
        gate { [weak self] in
            self?.withSession { context in
                try self?.boardRepo.updateLine(
                    id: id, patch: patch, locationId: self?.locationId ?? "default", context: context)
            }
        }
    }

    func requestDeleteLine(id: Int64) {
        errorMessage = nil
        gate { [weak self] in
            self?.withSession { context in
                try self?.boardRepo.deleteLine(
                    id: id, locationId: self?.locationId ?? "default", context: context)
            }
        }
    }

    func requestAddCourse() {
        errorMessage = nil
        guard let eventId = selectedEventId else { return }
        let label = newCourseLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else {
            errorMessage = "Course needs a name"
            return
        }
        // combineToIso returns nil BOTH for a bad time and a missing event
        // date — tell the operator which one is actually blocking them.
        let eventDate = (selectedEvent?.eventDate ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !eventDate.isEmpty else {
            errorMessage = "Set the party's date first — fire times need a date"
            return
        }
        guard let fireAt = BeoCourseRules.combineToIso(
            eventDate: eventDate, hhmm: Self.normalizeHHMM(newCourseTime)
        ) else {
            errorMessage = "Pick a fire time (HH:MM)"
            return
        }
        let draft = BeoCourseRules.CourseDraft(courseLabel: label, fireAt: fireAt)
        gate { [weak self] in
            self?.withSession { context in
                _ = try self?.coursesRepo.create(
                    eventId: eventId, draft: draft,
                    locationId: self?.locationId ?? "default", context: context)
                self?.newCourseLabel = ""
                self?.newCourseTime = ""
            }
        }
    }

    func requestDeleteCourse(id: Int64) {
        errorMessage = nil
        gate { [weak self] in
            self?.withSession { context in
                try self?.coursesRepo.delete(
                    id: id, locationId: self?.locationId ?? "default", context: context)
            }
        }
    }

    /// Bind / unbind a line to a course (the web COURSE column select).
    func requestBindLine(lineId: Int64, courseId: Int64?) {
        requestUpdateLine(id: lineId, patch: BeoLinePatch(courseId: .set(courseId)))
    }

    func pinVerified(_ user: ManagerPinUser) {
        pinStore.save(user: user)
        pinVerifiedWhileSheetUp = true
        let action = pendingAction
        pendingAction = nil
        action?()
    }

    /// Hooked to the PIN sheet's `onDismiss`. Cancelling the sheet must not
    /// silently discard the pending write while the field keeps showing the
    /// unsaved value: report it, drop the action, and rebuild the editors so
    /// they re-adopt the persisted row values.
    func pinSheetDismissed() {
        if pinVerifiedWhileSheetUp {
            pinVerifiedWhileSheetUp = false
            return
        }
        guard pendingAction != nil else { return }
        pendingAction = nil
        errorMessage = "PIN required — change not saved"
        editorGeneration += 1
        Task { await refresh() }
    }

    // ── internals ────────────────────────────────────────────────────────

    /// Accept the natural "5:30" by zero-padding to the "HH:MM" shape
    /// `BeoCourseRules.combineToIso` requires. Anything else passes through
    /// untouched (the rule module stays the validator).
    static func normalizeHHMM(_ raw: String) -> String {
        let t = raw.trimmingCharacters(in: .whitespaces)
        if t.range(of: #"^\d:\d{2}$"#, options: .regularExpression) != nil {
            return "0" + t
        }
        return t
    }

    private func gate(_ action: @escaping () -> Void) {
        if pinStore.activeUser != nil {
            action()
        } else {
            pendingAction = action
            showPinSheet = true
        }
    }

    private func withSession(_ body: (RegulatedWriteContext) throws -> Void) {
        isSaving = true
        defer { isSaving = false }
        do {
            let user = try ManagementWrite().requireSession(pinStore.session)
            try writeDB.pool.read { db in try pinStore.validateActiveUser(db: db) }
            try body(RegulatedWriteContext.nativeMac(pinUser: user))
            Task {
                await refresh()
                // Cascade/fire panels are event-derived — refetch on next open.
                cascade = nil
                fire = nil
                await loadTabData()
            }
        } catch {
            errorMessage = WriteErrorMapper.message(for: error)
        }
    }
}
