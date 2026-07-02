import SwiftUI
import LariatDB
import LariatModel

/// Native port of `/beo` (BeoBoard) — the parties & BEOs operator board.
/// Prep-sheet layout: ITEM / PREP / SECONDARY PREP / ORDER ITEMS + course
/// binding, invoice math, courses rail, catering-menu picker, and past-prep
/// reference; Order guide / Prep / Fire tabs mirror the web tab bar. The web
/// "Share with client" flow is an edge blocker (guest-facing) — not ported.
struct BeoBoardView: View {
    @State private var vm: BeoBoardViewModel
    @State private var confirmKill = false

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: BeoBoardViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.events.isEmpty {
                TileDegrade(title: "Could not load parties", message: err, systemImage: "party.popper")
            } else if !vm.loaded {
                ProgressView("Loading parties…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Parties & BEOs")
        .task { await vm.refresh() }
        .sheet(isPresented: $vm.showPinSheet) {
            PinEntrySheet(database: vm.writeDatabase) { user in
                vm.pinVerified(user)
            }
        }
        .confirmationDialog(
            "Delete this party and everything under it?",
            isPresented: $confirmKill,
            titleVisibility: .visible
        ) {
            Button("Kill party", role: .destructive) { vm.requestKillParty() }
            Button("Keep it", role: .cancel) {}
        }
    }

    // ── layout ───────────────────────────────────────────────────────────

    private var content: some View {
        HStack(spacing: 0) {
            eventSidebar
                .frame(width: 250)
            Divider()
            detail
        }
    }

    private var eventSidebar: some View {
        List(selection: $vm.selectedEventId) {
            Section("Parties") {
                if vm.filteredEvents.isEmpty {
                    EmptyState(message: "No parties yet.", systemImage: "party.popper")
                }
                ForEach(vm.filteredEvents) { ev in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ev.title).fontWeight(.medium)
                        Text("\(ev.eventDate ?? "no date")\(ev.eventTime.map { " (\($0))" } ?? "")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .tag(ev.id)
                }
            }
            Section("New party") {
                addPartyForm
            }
        }
        .searchable(text: $vm.eventQuery, prompt: "Find a party")
    }

    private var addPartyForm: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Party name (e.g. Bob Clauss)", text: $vm.newTitle)
            TextField("Date (YYYY-MM-DD)", text: $vm.newDate)
            TextField("Time (5-7pm)", text: $vm.newTime)
            TextField("Contact", text: $vm.newContact)
            TextField("Covers", text: $vm.newGuests)
            TextField("Notes (allergies, setup requests)", text: $vm.newNotes)
            Button("Add party") { vm.requestAddParty() }
                .disabled(vm.isSaving)
        }
        .textFieldStyle(.roundedBorder)
        .font(.callout)
    }

    @ViewBuilder
    private var detail: some View {
        if let event = vm.selectedEvent {
            VStack(alignment: .leading, spacing: 0) {
                if let errorMessage = vm.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(LariatTheme.bad)
                        .padding(.horizontal)
                        .padding(.top, 6)
                }
                HStack {
                    Picker("", selection: $vm.tab) {
                        ForEach(BeoBoardViewModel.Tab.allCases) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 420)
                    Spacer()
                    Button("Kill party", role: .destructive) { confirmKill = true }
                        .disabled(vm.isSaving)
                }
                .padding([.horizontal, .top])

                switch vm.tab {
                case .sheet:
                    sheetTab(event)
                case .orderGuide:
                    BeoOrderGuidePanel(cascade: vm.cascade, loading: vm.cascadeLoading)
                case .prep:
                    BeoPrepDemandsPanel(cascade: vm.cascade, loading: vm.cascadeLoading)
                case .fire:
                    BeoEventFirePanel(fire: vm.fire, loading: vm.fireLoading)
                }
            }
        } else {
            EmptyState(message: "Pick or add a party to start building its BEO.", systemImage: "party.popper")
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    // ── Sheet tab ────────────────────────────────────────────────────────

    private func sheetTab(_ event: BeoEventRow) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BeoEventHeaderEditor(event: event) { patch in
                        vm.requestUpdateEvent(patch)
                    }
                    prepSheet(event)
                }
                .padding()
            }
            Divider()
            rail
                .frame(width: 300)
        }
    }

    private func prepSheet(_ event: BeoEventRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Prep sheet")
                .font(.headline)
            if vm.lineItems.isEmpty {
                EmptyState(message: "No items yet. Pick from the menu on the right →", systemImage: "fork.knife")
            } else {
                ForEach(vm.lineItems) { line in
                    BeoLineRowEditor(
                        line: line,
                        courses: vm.courses,
                        onPatch: { patch in vm.requestUpdateLine(id: line.id, patch: patch) },
                        onDelete: { vm.requestDeleteLine(id: line.id) }
                    )
                    Divider()
                }
            }
            totalsFooter(event)
        }
    }

    private func totalsFooter(_ event: BeoEventRow) -> some View {
        let totals = vm.totals
        return VStack(alignment: .trailing, spacing: 4) {
            HStack {
                Spacer()
                Text("Sub total").foregroundStyle(.secondary)
                Text(formatDollars(totals.subtotal, decimals: 2)).monospacedDigit()
            }
            HStack {
                Spacer()
                Text("Tax").foregroundStyle(.secondary)
                CommitTextField(
                    value: event.taxRate.map { String($0) } ?? "",
                    placeholder: "rate",
                    width: 70
                ) { raw in
                    if let v = Double(raw) { vm.requestUpdateEvent(BeoEventPatch(taxRate: v)) }
                }
                Text("rate").font(.caption).foregroundStyle(.tertiary)
                Text(formatDollars(totals.tax, decimals: 2)).monospacedDigit()
            }
            HStack {
                Spacer()
                Text("Service fee").foregroundStyle(.secondary)
                CommitTextField(
                    value: event.serviceFeePct.map { String($0) } ?? "",
                    placeholder: "%",
                    width: 60
                ) { raw in
                    if let v = Double(raw) { vm.requestUpdateEvent(BeoEventPatch(serviceFeePct: v)) }
                }
                Text("%").font(.caption).foregroundStyle(.tertiary)
                Text(formatDollars(totals.fee, decimals: 2)).monospacedDigit()
            }
            HStack {
                Spacer()
                Text("Total").fontWeight(.bold)
                Text(formatDollars(totals.total, decimals: 2)).fontWeight(.bold).monospacedDigit()
            }
        }
        .font(.callout)
    }

    // ── right rail: menu picker + courses + past prep ────────────────────

    private var rail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                menuPanel
                coursesPanel
                pastPrepPanel
            }
            .padding()
        }
    }

    private var menuPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Catering menu").font(.headline)
            TextField("Filter menu…", text: $vm.menuFilter)
                .textFieldStyle(.roundedBorder)
            if vm.filteredMenu.isEmpty {
                EmptyState(message: "No matches.", systemImage: "magnifyingglass")
            }
            ForEach(vm.filteredMenu, id: \.category) { group in
                DisclosureGroup(group.category) {
                    ForEach(group.items) { item in
                        Button {
                            vm.requestAddLine(item)
                        } label: {
                            HStack {
                                Text(item.name)
                                Spacer()
                                Text(formatDollars(item.cost, decimals: 2))
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                                Image(systemName: "plus.circle")
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(vm.isSaving || vm.selectedEvent == nil)
                    }
                }
                .font(.callout)
            }
        }
    }

    private var coursesPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Courses").font(.headline)
            Text("fire times for this event")
                .font(.caption)
                .foregroundStyle(.secondary)
            if vm.courses.isEmpty {
                EmptyState(message: "No courses yet. Add one below.", systemImage: "timer")
            }
            ForEach(vm.courses) { course in
                HStack {
                    Text(course.courseLabel).fontWeight(.medium)
                    Spacer()
                    Text(BeoCourseRules.isoToLocalHHMM(course.fireAt))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    Button(role: .destructive) {
                        vm.requestDeleteCourse(id: course.id)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .disabled(vm.isSaving)
                    .accessibilityLabel("Delete \(course.courseLabel)")
                }
                .font(.callout)
            }
            HStack {
                TextField("Course name (e.g. Entree)", text: $vm.newCourseLabel)
                TextField("HH:MM", text: $vm.newCourseTime)
                    .frame(width: 64)
                Button("Add") { vm.requestAddCourse() }
                    .disabled(vm.isSaving)
            }
            .textFieldStyle(.roundedBorder)
            .font(.callout)
        }
    }

    private var pastPrepPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Past prep").font(.headline)
            Text("Last few times we've prepped these items.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if vm.lineItems.isEmpty {
                EmptyState(message: "No items on this BEO yet.", systemImage: "clock.arrow.circlepath")
            } else if vm.pastPrep.isEmpty {
                EmptyState(message: "No prior prep on file for these items.", systemImage: "clock.arrow.circlepath")
            }
            ForEach(vm.pastPrep) { match in
                DisclosureGroup(match.item) {
                    ForEach(Array(match.history.enumerated()), id: \.offset) { _, h in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(h.eventDate ?? "undated")
                                Text(h.client ?? "unknown client").foregroundStyle(.secondary)
                                if let qty = h.amountQty { Text("× \(qty)") }
                            }
                            .font(.caption)
                            if let prepDay = h.prepDay {
                                Text("Prep day: \(prepDay)").font(.caption2).foregroundStyle(.secondary)
                            }
                            if let pre = h.prePrepNotes {
                                Text("Pre-prep: \(pre)").font(.caption2).foregroundStyle(.secondary)
                            }
                            if let plating = h.platingNotes {
                                Text("Plating: \(plating)").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                .font(.callout)
            }
        }
    }
}

// ── event header editor (title / date / time / contact / covers / min spend / notes) ──

private struct BeoEventHeaderEditor: View {
    let event: BeoEventRow
    let onPatch: (BeoEventPatch) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CommitTextField(value: event.title, placeholder: "Party name", font: .title3) { raw in
                let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty, t != event.title { onPatch(BeoEventPatch(title: t)) }
            }
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                GridRow {
                    labeled("Date") {
                        CommitTextField(value: event.eventDate ?? "", placeholder: "YYYY-MM-DD") {
                            if $0 != (event.eventDate ?? "") { onPatch(BeoEventPatch(eventDate: $0)) }
                        }
                    }
                    labeled("Time") {
                        CommitTextField(value: event.eventTime ?? "", placeholder: "5-7pm") {
                            if $0 != (event.eventTime ?? "") { onPatch(BeoEventPatch(eventTime: $0)) }
                        }
                    }
                    labeled("Contact") {
                        CommitTextField(value: event.contactName ?? "", placeholder: "point of contact") {
                            if $0 != (event.contactName ?? "") { onPatch(BeoEventPatch(contactName: $0)) }
                        }
                    }
                }
                GridRow {
                    labeled("Covers") {
                        CommitTextField(value: event.guestCount.map(String.init) ?? "", placeholder: "0") {
                            if let n = Int($0), n != event.guestCount { onPatch(BeoEventPatch(guestCount: n)) }
                        }
                    }
                    labeled("Min spend ($)") {
                        CommitTextField(value: event.minSpend.map { String($0) } ?? "", placeholder: "F&B minimum") { raw in
                            if raw.isEmpty {
                                if event.minSpend != nil { onPatch(BeoEventPatch(minSpend: .set(nil))) }
                            } else if let v = Double(raw), v != event.minSpend {
                                onPatch(BeoEventPatch(minSpend: .set(v)))
                            }
                        }
                    }
                    labeled("Notes") {
                        CommitTextField(value: event.notes ?? "", placeholder: "Allergies, dietary restrictions, setup requests") {
                            if $0 != (event.notes ?? "") { onPatch(BeoEventPatch(notes: $0)) }
                        }
                    }
                }
            }
            .font(.callout)
        }
    }

    private func labeled(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            content()
        }
    }
}

// ── one prep-sheet line (ITEM / PREP / SECONDARY / ORDER ITEMS / COURSE / TIME / COST / QTY) ──

private struct BeoLineRowEditor: View {
    let line: BeoLineItemRow
    let courses: [BeoCourseRow]
    let onPatch: (BeoLinePatch) -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                CommitTextField(value: line.itemName, placeholder: "item", font: .body) { raw in
                    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty, t != line.itemName { onPatch(BeoLinePatch(itemName: t)) }
                }
                .frame(minWidth: 140)

                coursePicker

                CommitTextField(value: line.orderTime ?? "", placeholder: "5:30pm", width: 70) {
                    if $0 != (line.orderTime ?? "") { onPatch(BeoLinePatch(orderTime: .set($0))) }
                }
                CommitTextField(value: String(line.unitCost), placeholder: "cost", width: 70) {
                    if let v = Double($0), v != line.unitCost { onPatch(BeoLinePatch(unitCost: v)) }
                }
                CommitTextField(value: String(line.quantity), placeholder: "qty", width: 56) {
                    if let v = Double($0), v != line.quantity { onPatch(BeoLinePatch(quantity: v)) }
                }
                Text(formatDollars(BeoWorksheetCompute.lineTotal(unitCost: line.unitCost, quantity: line.quantity), decimals: 2))
                    .monospacedDigit()
                    .frame(width: 80, alignment: .trailing)
                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Remove line")
            }
            HStack(spacing: 8) {
                CommitTextField(value: line.prepNotes ?? "", placeholder: "prep (e.g. Pico de Gallo, mexi slaw)") {
                    if $0 != (line.prepNotes ?? "") { onPatch(BeoLinePatch(prepNotes: .set($0))) }
                }
                CommitTextField(value: line.secondaryPrepNotes ?? "", placeholder: "secondary prep (optional)") {
                    if $0 != (line.secondaryPrepNotes ?? "") { onPatch(BeoLinePatch(secondaryPrepNotes: .set($0))) }
                }
                CommitTextField(value: line.orderItemsNotes ?? "", placeholder: "ingredients to order") {
                    if $0 != (line.orderItemsNotes ?? "") { onPatch(BeoLinePatch(orderItemsNotes: .set($0))) }
                }
            }
            .font(.caption)
        }
        .padding(.vertical, 2)
    }

    private var coursePicker: some View {
        Picker("Course", selection: Binding<Int64?>(
            get: { line.courseId },
            set: { onPatch(BeoLinePatch(courseId: .set($0))) }
        )) {
            Text("—").tag(Int64?.none)
            ForEach(courses) { course in
                Text(course.courseLabel).tag(Int64?.some(course.id))
            }
        }
        .labelsHidden()
        .frame(width: 110)
    }
}

// ── cascade panels (Order guide / Prep tabs) ─────────────────────────────

private struct BeoOrderGuidePanel: View {
    let cascade: BeoCascadeOutcome?
    let loading: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if loading {
                    ProgressView("Running the cascade…")
                } else if let cascade {
                    BeoUnmappedCallout(unmapped: cascade.unmapped, engineError: cascade.engineError)
                    if cascade.orderGuide.isEmpty, cascade.unmapped.isEmpty, cascade.engineError == nil {
                        EmptyState(message: "No order guide items for this event yet.", systemImage: "cart")
                    } else {
                        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                            GridRow {
                                Text("Ingredient").fontWeight(.semibold)
                                Text("Total needed").fontWeight(.semibold)
                                Text("Unit").fontWeight(.semibold)
                                Text("To order").fontWeight(.semibold)
                            }
                            ForEach(Array(cascade.orderGuide.enumerated()), id: \.offset) { _, row in
                                GridRow {
                                    Text(row.ingredient)
                                    Text(row.totalNeeded.formatted()).monospacedDigit()
                                    Text(row.unit)
                                    Text(row.toOrder.formatted()).monospacedDigit()
                                }
                            }
                        }
                        .font(.callout)
                    }
                } else {
                    EmptyState(message: "Couldn't load order guide — reopen the tab to retry.", systemImage: "cart.badge.questionmark")
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct BeoPrepDemandsPanel: View {
    let cascade: BeoCascadeOutcome?
    let loading: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if loading {
                    ProgressView("Running the cascade…")
                } else if let cascade {
                    BeoUnmappedCallout(unmapped: cascade.unmapped, engineError: cascade.engineError)
                    if cascade.prepDemands.isEmpty, cascade.unmapped.isEmpty, cascade.engineError == nil {
                        EmptyState(message: "No prep demands for this event yet.", systemImage: "list.clipboard")
                    } else {
                        ForEach(Array(cascade.prepDemands.enumerated()), id: \.offset) { _, row in
                            HStack {
                                Text(row.displayName)
                                Spacer()
                                Text("\(row.qty.formatted()) \(row.unit)")
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                            .font(.callout)
                        }
                    }
                } else {
                    EmptyState(message: "Couldn't load prep demands — reopen the tab to retry.", systemImage: "list.clipboard")
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// UnmappedCallout parity: unmapped items and engine errors are surfaced,
/// never silently dropped.
private struct BeoUnmappedCallout: View {
    let unmapped: [CascadeUnmappedRow]
    let engineError: String?

    var body: some View {
        if engineError != nil || !unmapped.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if let engineError {
                    Label(engineError, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(LariatTheme.bad)
                }
                ForEach(Array(unmapped.enumerated()), id: \.offset) { _, row in
                    Label("\(row.menuItem) — \(row.reason)", systemImage: "questionmark.circle")
                        .foregroundStyle(LariatTheme.warn)
                }
            }
            .font(.caption)
            .padding(8)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
        }
    }
}

// ── per-event fire panel (Fire tab) ──────────────────────────────────────

private struct BeoEventFirePanel: View {
    let fire: BeoFireScheduleCompute.FireSchedulePayload?
    let loading: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if loading {
                    ProgressView("Loading fire schedule…")
                } else if let fire, !fire.stations.isEmpty {
                    ForEach(fire.stations) { station in
                        BeoFireStationSection(station: station)
                    }
                } else {
                    EmptyState(message: "No fire times set for this event yet.", systemImage: "flame")
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Shared station block — also used by the standalone fire-schedule board.
struct BeoFireStationSection: View {
    let station: BeoFireScheduleCompute.StationBucket
    var now: Date = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(station.stationId == BeoFireScheduleCompute.unassigned ? "Unassigned" : station.stationId)
                .font(.headline)
            ForEach(station.courses) { course in
                let bucket = BeoFireScheduleCompute.ageBucketFor(course.fireAt, now: now)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(course.courseLabel).fontWeight(.medium)
                        Text(course.eventTitle).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(BeoCourseRules.isoToLocalHHMM(course.fireAt))
                            .monospacedDigit()
                            .foregroundStyle(color(for: bucket))
                            .fontWeight(.semibold)
                    }
                    ForEach(course.lines) { line in
                        HStack(spacing: 6) {
                            Text(line.itemName)
                            Text("×\(line.quantity.formatted())").foregroundStyle(.secondary)
                            if let notes = line.prepNotes {
                                Text(notes).font(.caption).foregroundStyle(.tertiary)
                            }
                        }
                        .font(.callout)
                    }
                }
                .padding(8)
                .background(color(for: bucket).opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private func color(for bucket: BeoFireScheduleCompute.AgeBucket) -> Color {
        switch bucket {
        case .green: return LariatTheme.ok
        case .yellow: return LariatTheme.warn
        case .red: return LariatTheme.bad
        }
    }
}

// ── commit-on-submit text field (web onBlur-commit inputs) ───────────────

/// Local editing buffer that commits on submit / focus loss — the SwiftUI
/// analog of the web board's commit-on-blur `<input>`s.
struct CommitTextField: View {
    let value: String
    let placeholder: String
    let commit: (String) -> Void
    var font: Font?
    var width: CGFloat?

    @State private var text: String
    @FocusState private var focused: Bool

    init(value: String, placeholder: String, font: Font? = nil, width: CGFloat? = nil, commit: @escaping (String) -> Void) {
        self.value = value
        self.placeholder = placeholder
        self.commit = commit
        self.font = font
        self.width = width
        _text = State(initialValue: value)
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.roundedBorder)
            .font(font)
            .frame(width: width)
            .focused($focused)
            .onSubmit { commit(text) }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { commit(text) }
            }
            .onChange(of: value) { _, newValue in
                // External refresh (e.g. after a committed write) — adopt the
                // fresh row value unless the operator is mid-edit.
                if !focused { text = newValue }
            }
    }
}
