import SwiftUI
import LariatDB
import LariatModel
#if canImport(AppKit)
import AppKit
#endif

/// Native port of `/beo` (BeoBoard) — the parties & BEOs operator board.
/// Prep-sheet layout: ITEM / PREP / SECONDARY PREP / ORDER ITEMS + course
/// binding, invoice math, courses rail, catering-menu picker, and past-prep
/// reference; Order guide / Prep / Fire tabs mirror the web tab bar. The web
/// "Share with client" flow is an edge blocker (guest-facing) — not ported.
struct BeoBoardView: View {
    @State private var vm: BeoBoardViewModel
    @State private var confirmKill = false
    @State private var showAddParty = false
    @State private var showPrintPreview = false

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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The BEO is a printed worksheet: warm Lariat kraft paper, espresso
        // ink, one terracotta accent — held steady across system appearance.
        .background(LariatBrand.paper)
        .environment(\.colorScheme, .light)
        .tint(LariatBrand.terracotta)
        .foregroundStyle(LariatBrand.ink)
        .navigationTitle("Parties & BEOs")
        .task { await vm.refresh() }
        .sheet(isPresented: $vm.showPinSheet, onDismiss: { vm.pinSheetDismissed() }) {
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
        .sheet(isPresented: $showPrintPreview) { printPreview }
    }

    // ── layout ───────────────────────────────────────────────────────────

    private var content: some View {
        HStack(spacing: 0) {
            eventSidebar
                .frame(width: 264)
            Rectangle().fill(LariatBrand.line).frame(width: 1)
            detail
        }
    }

    private var eventSidebar: some View {
        VStack(spacing: 0) {
            HStack {
                Eyebrow("On the books")
                Spacer()
                Text("\(vm.filteredEvents.count)")
                    .font(.system(.caption, design: .serif))
                    .foregroundStyle(LariatBrand.inkSoft)
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 6)

            // A selection List (no text fields in the rows, so the #401 focus
            // trap doesn't apply) keeps ↑/↓ keyboard navigation while custom
            // row content + a hidden background carry the worksheet look.
            List(selection: $vm.selectedEventId) {
                if vm.filteredEvents.isEmpty {
                    EmptyState(message: "No parties yet.", systemImage: "party.popper")
                        .listRowBackground(Color.clear)
                }
                ForEach(vm.filteredEvents) { ev in
                    partyRow(ev)
                        .tag(ev.id)
                        .listRowBackground(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(vm.selectedEventId == ev.id ? LariatBrand.rose.opacity(0.6) : .clear)
                                .padding(.vertical, 1)
                        )
                        .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .searchable(text: $vm.eventQuery, prompt: "Find a party")

            Divider().overlay(LariatBrand.line)
            // Lives OUTSIDE any selection List: text fields inside a
            // List(selection:) never receive keyboard focus on macOS.
            Button {
                showAddParty = true
            } label: {
                Label("New party", systemImage: "plus")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(10)
        }
        .background(LariatBrand.panel)
        .sheet(isPresented: $showAddParty) { addPartySheet }
    }

    private func partyRow(_ ev: BeoEventRow) -> some View {
        let selected = vm.selectedEventId == ev.id
        return HStack(spacing: 10) {
            Rectangle()
                .fill(selected ? LariatBrand.terracotta : .clear)
                .frame(width: 3)
                .clipShape(Capsule())
            VStack(alignment: .leading, spacing: 3) {
                Text(ev.title)
                    .font(.system(.callout, design: .serif).weight(selected ? .semibold : .regular))
                    .foregroundStyle(LariatBrand.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(ev.eventDate ?? "no date")
                    if let t = ev.eventTime { Text("· \(t)") }
                    if let g = ev.guestCount { Text("· \(g) covers") }
                }
                .font(.caption)
                .foregroundStyle(LariatBrand.inkSoft)
                .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var addPartySheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow("New booking")
            SerifHeader("Start a party", size: .title2)
            VStack(alignment: .leading, spacing: 8) {
                TextField("Party name (e.g. Bob Clauss)", text: $vm.newTitle)
                TextField("Date (YYYY-MM-DD)", text: $vm.newDate)
                TextField("Time (5-7pm)", text: $vm.newTime)
                TextField("Contact", text: $vm.newContact)
                TextField("Covers", text: $vm.newGuests)
                TextField("Notes (allergies, setup requests)", text: $vm.newNotes)
            }
            .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Cancel") { showAddParty = false }
                    .keyboardShortcut(.cancelAction)
                Button("Add party") {
                    // Dismiss first — the PIN sheet may need to present next,
                    // and two sheets can't be up at once.
                    showAddParty = false
                    vm.requestAddParty()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(vm.isSaving
                    || vm.newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(minWidth: 380)
        .background(LariatBrand.paper)
        .environment(\.colorScheme, .light)
        .tint(LariatBrand.terracotta)
        .foregroundStyle(LariatBrand.ink)
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
                    Button("Print preview") { showPrintPreview = true }
                    Button(role: .destructive) { confirmKill = true } label: {
                        Label("Kill party", systemImage: "trash")
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(LariatBrand.bad)
                    .disabled(vm.isSaving)
                }
                .padding([.horizontal, .top])

                switch vm.tab {
                case .sheet:
                    // Rebuilt when a pending write is discarded (PIN sheet
                    // cancelled) so CommitTextFields re-adopt the persisted
                    // row values instead of keeping the unsaved text.
                    sheetTab(event)
                        .id(vm.editorGeneration)
                case .recipes:
                    BeoRecipeTreePanel(
                        items: vm.lineItems.map(\.itemName),
                        breakdown: { vm.recipeBreakdown(for: $0) },
                        timings: { vm.recipeTimings(for: $0) },
                        available: vm.recipeTreeAvailable
                    )
                case .orderGuide:
                    BeoOrderGuidePanel(cascade: vm.cascade, loading: vm.cascadeLoading)
                case .prep:
                    BeoPrepDemandsPanel(cascade: vm.cascade, loading: vm.cascadeLoading)
                case .fire:
                    BeoEventFirePanel(fire: vm.fire, loading: vm.fireLoading)
                }
            }
        } else {
            VStack(spacing: 10) {
                Image(systemName: "menucard")
                    .font(.system(size: 44))
                    .foregroundStyle(LariatBrand.terracotta.opacity(0.7))
                Eyebrow("Banquet Event Order")
                SerifHeader("Build a party's BEO", size: .title2)
                Text("Pick a party on the left, or start a new one.")
                    .font(.callout)
                    .foregroundStyle(LariatBrand.inkSoft)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // ── Sheet tab ────────────────────────────────────────────────────────

    private func sheetTab(_ event: BeoEventRow) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    BeoEventHeaderEditor(event: event) { patch in
                        vm.requestUpdateEvent(patch)
                    }
                    prepSheet(event)
                }
                .padding(20)
            }
            Rectangle().fill(LariatBrand.line).frame(width: 1)
            rail
                .frame(width: 308)
        }
    }

    private func prepSheet(_ event: BeoEventRow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SerifHeader("Prep sheet")
                if !vm.lineItems.isEmpty {
                    Text("\(vm.lineItems.count) items")
                        .font(.caption).foregroundStyle(LariatBrand.inkSoft)
                }
                Spacer()
                addMenuItemDropdown
            }
            if vm.lineItems.isEmpty {
                EmptyState(message: "No items yet. Add one from the menu dropdown ↗", systemImage: "fork.knife")
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(vm.lineItems.enumerated()), id: \.element.id) { idx, line in
                        if idx > 0 {
                            Rectangle().fill(LariatBrand.line).frame(height: 1)
                        }
                        BeoLineRowEditor(
                            line: line,
                            courses: vm.courses,
                            amountHint: vm.amountHint(for: line.itemName),
                            onPatch: { patch in vm.requestUpdateLine(id: line.id, patch: patch) },
                            onDelete: { vm.requestDeleteLine(id: line.id) }
                        )
                        .padding(.vertical, 8)
                    }
                }
            }
            totalsFooter(event)
        }
        .worksheetCard(16)
    }

    private func totalsFooter(_ event: BeoEventRow) -> some View {
        let totals = vm.totals
        return VStack(spacing: 6) {
            invoiceRow("Subtotal", value: totals.subtotal)
            HStack(spacing: 8) {
                Text("Tax").foregroundStyle(LariatBrand.inkSoft)
                CommitTextField(value: event.taxRate.map { String($0) } ?? "", placeholder: "rate", width: 56) { raw in
                    if let v = Double(raw) { vm.requestUpdateEvent(BeoEventPatch(taxRate: v)) }
                }
                .accessibilityLabel("Tax rate")
                Text("rate").font(.caption2).foregroundStyle(LariatBrand.inkFaint)
                Spacer()
                Text(formatDollars(totals.tax, decimals: 2)).monospacedDigit()
            }
            HStack(spacing: 8) {
                Text("Service fee").foregroundStyle(LariatBrand.inkSoft)
                CommitTextField(value: event.serviceFeePct.map { String($0) } ?? "", placeholder: "%", width: 48) { raw in
                    if let v = Double(raw) { vm.requestUpdateEvent(BeoEventPatch(serviceFeePct: v)) }
                }
                .accessibilityLabel("Service fee percentage")
                Text("%").font(.caption2).foregroundStyle(LariatBrand.inkFaint)
                Spacer()
                Text(formatDollars(totals.fee, decimals: 2)).monospacedDigit()
            }
            Rectangle().fill(LariatBrand.line).frame(height: 1).padding(.vertical, 2)
            HStack {
                Text("Total")
                    .font(.system(.title3, design: .serif).weight(.semibold))
                Spacer()
                Text(formatDollars(totals.total, decimals: 2))
                    .font(.system(.title3, design: .serif).weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(LariatBrand.clay)
            }
            .accessibilityElement(children: .combine)
        }
        .font(.callout)
        .padding(12)
        .background(LariatBrand.sunk, in: RoundedRectangle(cornerRadius: 8))
        .frame(maxWidth: 360, alignment: .trailing)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.top, 4)
    }

    private func invoiceRow(_ label: String, value: Double) -> some View {
        HStack {
            Text(label).foregroundStyle(LariatBrand.inkSoft)
            Spacer()
            Text(formatDollars(value, decimals: 2)).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    // ── right rail: menu picker + courses + past prep ────────────────────

    private var rail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                menuPanel.worksheetCard()
                coursesPanel.worksheetCard()
                pastPrepPanel.worksheetCard()
            }
            .padding(14)
            .frame(maxWidth: .infinity)
        }
        .background(LariatBrand.sunk.opacity(0.5))
    }

    /// Real dropdown menu: pick an item → a fully-populated line (price + prep
    /// + plating + order notes) drops straight onto the prep sheet. Grouped by
    /// category as nested submenus; disabled until a party is selected.
    private var addMenuItemDropdown: some View {
        Menu {
            if vm.menu.isEmpty {
                Text("Catering menu cache missing")
            } else {
                ForEach(vm.menuGroups, id: \.category) { group in
                    Menu(group.category) {
                        ForEach(group.items) { item in
                            Button {
                                vm.requestAddLine(item)
                            } label: {
                                // "＋  Nashville Slider — $6.00  ·  prep"
                                Text(menuItemLabel(item))
                            }
                        }
                    }
                }
            }
        } label: {
            Label("Add menu item", systemImage: "plus.circle.fill")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .disabled(vm.isSaving || vm.selectedEvent == nil)
    }

    private func menuItemLabel(_ item: CateringMenuItem) -> String {
        var parts = ["\(item.name) — \(formatDollars(item.cost, decimals: 2))"]
        if !item.amountDescription.isEmpty { parts.append(item.amountDescription) }
        if item.hasPrepDefaults { parts.append("prep ready") }
        return parts.joined(separator: "  ·  ")
    }

    private var menuPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            SerifHeader("Catering menu")
            Text("Pick to add a line with price + prep pre-filled.")
                .font(.caption).foregroundStyle(LariatBrand.inkSoft)
            TextField("Filter menu…", text: $vm.menuFilter)
                .textFieldStyle(.roundedBorder)
            if vm.menu.isEmpty {
                // Missing/corrupt cache is NOT a filter mismatch — say what
                // actually broke and how to fix it.
                EmptyState(
                    message: "Catering menu cache missing — run the menu ingest to rebuild data/cache/catering_menu.json.",
                    systemImage: "exclamationmark.triangle"
                )
            } else if vm.filteredMenu.isEmpty {
                EmptyState(message: "No matches.", systemImage: "magnifyingglass")
            }
            ForEach(vm.filteredMenu, id: \.category) { group in
                DisclosureGroup {
                    ForEach(group.items) { item in
                        Button {
                            vm.requestAddLine(item)
                        } label: {
                            HStack(spacing: 6) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.name).foregroundStyle(LariatBrand.ink)
                                    if !item.amountDescription.isEmpty {
                                        Text(item.amountDescription)
                                            .font(.caption2).foregroundStyle(LariatBrand.inkFaint)
                                    }
                                }
                                Spacer()
                                if item.hasPrepDefaults {
                                    Text("prep")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(LariatBrand.clay)
                                }
                                Text(formatDollars(item.cost, decimals: 2))
                                    .foregroundStyle(LariatBrand.inkSoft)
                                    .monospacedDigit()
                                Image(systemName: "plus.circle.fill")
                                    .foregroundStyle(LariatBrand.terracotta)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 2)
                        .disabled(vm.isSaving || vm.selectedEvent == nil)
                        .accessibilityElement(children: .combine)
                    }
                } label: {
                    Text(group.category)
                        .font(.system(.subheadline, design: .serif).weight(.semibold))
                        .foregroundStyle(LariatBrand.clay)
                }
                .font(.callout)
            }
        }
    }

    private var coursesPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            SerifHeader("Courses")
            Text("Fire times for this event.")
                .font(.caption)
                .foregroundStyle(LariatBrand.inkSoft)
            if vm.courses.isEmpty {
                EmptyState(message: "No courses yet. Add one below.", systemImage: "timer")
            }
            ForEach(vm.courses) { course in
                HStack {
                    HStack {
                        Text(course.courseLabel).fontWeight(.medium)
                        Spacer()
                        Text(BeoCourseRules.isoToLocalHHMM(course.fireAt))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
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
            SerifHeader("Past prep")
            Text("Last few times we've prepped these items.")
                .font(.caption)
                .foregroundStyle(LariatBrand.inkSoft)
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

    // ── Print preview (BeoPrintCompute computation) ─────────────────────

    /// Renders the SAME event/lines/courses/totals the sheet tab already
    /// shows — `vm.totals` is the board's own `BeoWorksheetCompute.totals`
    /// call, so the print sheet never recomputes money. Cascade/order-guide
    /// data is intentionally excluded from the print path.
    @ViewBuilder
    private var printPreview: some View {
        NavigationStack {
            ScrollView {
                if let event = vm.selectedEvent {
                    Text(BeoPrintCompute.renderText(
                        event: event, lines: vm.lineItems, courses: vm.courses, totals: vm.totals))
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
            }
            .navigationTitle("BEO sheet")
            .toolbar {
                #if canImport(AppKit)
                ToolbarItem {
                    Button("Copy") {
                        if let event = vm.selectedEvent {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(
                                BeoPrintCompute.renderText(
                                    event: event, lines: vm.lineItems, courses: vm.courses, totals: vm.totals),
                                forType: .string)
                        }
                    }
                    .disabled(vm.selectedEvent == nil)
                }
                ToolbarItem {
                    Button("Print") {
                        if let event = vm.selectedEvent {
                            Self.printBeo(event: event, lines: vm.lineItems, courses: vm.courses, totals: vm.totals)
                        }
                    }
                    .disabled(vm.selectedEvent == nil)
                }
                #endif
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showPrintPreview = false }
                }
            }
        }
        .frame(minWidth: 520, minHeight: 560)
    }

    #if canImport(AppKit)
    /// Print the SAME monospaced BEO sheet text the preview renders —
    /// `BeoPrintCompute.renderText` stays the single computation.
    private static func printBeo(
        event: BeoEventRow, lines: [BeoLineItemRow], courses: [BeoCourseRow], totals: BeoWorksheetCompute.Totals
    ) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 486, height: 700))
        textView.string = BeoPrintCompute.renderText(event: event, lines: lines, courses: courses, totals: totals)
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        let operation = NSPrintOperation(view: textView)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }
    #endif
}

// ── event header editor (title / date / time / contact / covers / min spend / notes) ──

private struct BeoEventHeaderEditor: View {
    let event: BeoEventRow
    let onPatch: (BeoEventPatch) -> Void

    /// Eyebrow above the party name — the worksheet's own header line.
    private var docLine: String {
        var parts = ["Banquet Event Order"]
        if let d = event.eventDate, !d.isEmpty { parts.append(d) }
        if let t = event.eventTime, !t.isEmpty { parts.append(t) }
        if let g = event.guestCount { parts.append("\(g) covers") }
        return parts.joined(separator: "  ·  ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(docLine)
            CommitTextField(value: event.title, placeholder: "Party name",
                            font: .system(.title, design: .serif).weight(.semibold)) { raw in
                let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty, t != event.title { onPatch(BeoEventPatch(title: t)) }
            }
            .foregroundStyle(LariatBrand.ink)
            RopeRule().padding(.bottom, 4)
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
            Eyebrow(label)
            content()
                .accessibilityLabel(label)
        }
    }
}

// ── one prep-sheet line (ITEM / PREP / SECONDARY / ORDER ITEMS / COURSE / TIME / COST / QTY) ──

private struct BeoLineRowEditor: View {
    let line: BeoLineItemRow
    let courses: [BeoCourseRow]
    var amountHint: String? = nil
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
                    .frame(minWidth: 80, alignment: .trailing)
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
            if let amountHint {
                Label(amountHint, systemImage: "number")
                    .font(.caption2)
                    .foregroundStyle(LariatBrand.inkFaint)
            }
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
                    BeoUnmappedCallout(
                        unmapped: cascade.unmapped,
                        warnings: cascade.warnings,
                        engineError: cascade.engineError
                    )
                    if cascade.orderGuide.isEmpty, cascade.unmapped.isEmpty, cascade.warnings.isEmpty, cascade.engineError == nil {
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
                                .accessibilityElement(children: .combine)
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
                    BeoUnmappedCallout(
                        unmapped: cascade.unmapped,
                        warnings: cascade.warnings,
                        engineError: cascade.engineError
                    )
                    if cascade.prepDemands.isEmpty, cascade.unmapped.isEmpty, cascade.warnings.isEmpty, cascade.engineError == nil {
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
                            .accessibilityElement(children: .combine)
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

/// UnmappedCallout parity: engine errors, graceful-degradation warnings, and
/// unmapped items are surfaced, never silently dropped.
private struct BeoUnmappedCallout: View {
    let unmapped: [CascadeUnmappedRow]
    let warnings: [String]
    let engineError: String?

    var body: some View {
        if engineError != nil || !warnings.isEmpty || !unmapped.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if let engineError {
                    Label(engineError, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(LariatTheme.bad)
                }
                if !warnings.isEmpty {
                    Text("Some recipes were skipped — order and prep may be short:")
                        .fontWeight(.semibold)
                    ForEach(Array(warnings.enumerated()), id: \.offset) { _, warning in
                        Label(warning, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(LariatTheme.warn)
                    }
                }
                ForEach(Array(unmapped.enumerated()), id: \.offset) { _, row in
                    Label("\(row.menuItem) — \(row.reason)", systemImage: "questionmark.circle")
                        .foregroundStyle(LariatTheme.warn)
                }
            }
            .font(.caption)
            .padding(8)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            .accessibilityIdentifier("event-cascade-warnings")
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
                            .accessibilityLabel("\(BeoCourseRules.isoToLocalHHMM(course.fireAt)), \(statusLabel(for: bucket))")
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

    private func statusLabel(for bucket: BeoFireScheduleCompute.AgeBucket) -> String {
        switch bucket {
        case .green: return "on time"
        case .yellow: return "due soon"
        case .red: return "overdue"
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

// ── worksheet styling primitives (Lariat brand) ──────────────────────────

/// Tracked, uppercase eyebrow — the small caption above a serif header.
private struct Eyebrow: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(.caption2, design: .default).weight(.semibold))
            .tracking(1.6)
            .foregroundStyle(LariatBrand.inkSoft)
    }
}

/// Serif section heading — the menu/worksheet voice.
private struct SerifHeader: View {
    let text: String
    var size: Font.TextStyle = .headline
    init(_ text: String, size: Font.TextStyle = .headline) { self.text = text; self.size = size }
    var body: some View {
        Text(text)
            .font(.system(size, design: .serif).weight(.semibold))
            .foregroundStyle(LariatBrand.ink)
    }
}

/// The terracotta "rope" rule — a double hairline that closes a worksheet head.
private struct RopeRule: View {
    var body: some View {
        VStack(spacing: 2) {
            Rectangle().fill(LariatBrand.terracotta).frame(height: 1.5)
            Rectangle().fill(LariatBrand.terracotta.opacity(0.35)).frame(height: 1)
        }
    }
}

private extension View {
    /// A lifted cream card with a warm hairline border.
    func worksheetCard(_ pad: CGFloat = 14) -> some View {
        self
            .padding(pad)
            .background(LariatBrand.panel, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(LariatBrand.line, lineWidth: 1))
    }
}

// ── Recipe tab: the make-ahead prep breakdown per menu item ──────────────

private extension PrepTiming {
    var accent: Color {
        switch self {
        case .overnight: return LariatBrand.clay
        case .dayBefore: return LariatBrand.terracotta
        case .dayOf: return LariatBrand.ok
        }
    }
}

/// For every item on the BEO, its full in-house recipe tree — what to make and
/// when. Expands sub-recipes down to purchased ingredients (Mexi Slaw →
/// Chipotle Aioli → mayo + adobo), with an Overnight / Day-before / Day-of
/// timing badge on each component.
private struct BeoRecipeTreePanel: View {
    let items: [String]
    let breakdown: (String) -> [RecipeTreeNode]
    let timings: (String) -> [PrepTiming]
    let available: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !available {
                    EmptyState(
                        message: "Recipe tree cache missing — run scripts/ingest_beo_recipe_tree.py to rebuild data/cache/beo_recipe_tree.json.",
                        systemImage: "exclamationmark.triangle"
                    )
                } else if items.isEmpty {
                    EmptyState(message: "Add items on the Sheet tab to see their prep breakdown.", systemImage: "list.bullet.indent")
                } else {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        itemCard(item)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func itemCard(_ item: String) -> some View {
        let nodes = breakdown(item)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                SerifHeader(item)
                Spacer()
                ForEach(timings(item), id: \.self) { t in
                    timingChip(t)
                }
            }
            .accessibilityElement(children: .combine)
            if nodes.isEmpty {
                Text("No in-house recipe breakdown on file — this item plates as-is.")
                    .font(.caption)
                    .foregroundStyle(LariatBrand.inkSoft)
            } else {
                ForEach(nodes) { node in
                    RecipeNodeRow(node: node, depth: 0)
                }
            }
        }
        .worksheetCard(14)
    }

    private func timingChip(_ t: PrepTiming) -> some View {
        Text(t.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(t.accent)
            .background(t.accent.opacity(0.14), in: Capsule())
    }
}

/// One recipe in the tree: an "In-house" badge, its timing + station, purchased
/// ingredients, and any nested sub-recipes. Recurses via DisclosureGroup so a
/// cook can drill from Mexi Slaw into its Chipotle Aioli.
private struct RecipeNodeRow: View {
    let node: RecipeTreeNode
    let depth: Int
    @State private var expanded = true

    private var hasDetail: Bool { !node.leaves.isEmpty || !node.children.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(node.leaves) { leaf in
                        HStack(spacing: 6) {
                            Circle().fill(LariatBrand.inkFaint).frame(width: 3, height: 3)
                            Text(leaf.summary)
                                .font(.caption)
                                .foregroundStyle(LariatBrand.inkSoft)
                        }
                    }
                    ForEach(node.children) { child in
                        RecipeNodeRow(node: child, depth: depth + 1)
                    }
                }
                .padding(.leading, 14)
                .padding(.top, 2)
            } label: {
                header
            }
            .disclosureGroupStyle(.automatic)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(node.name)
                .font(.system(.subheadline, design: .serif).weight(.semibold))
                .foregroundStyle(LariatBrand.ink)
            Text("in-house")
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .foregroundStyle(LariatBrand.clay)
                .overlay(Capsule().stroke(LariatBrand.clay.opacity(0.4), lineWidth: 1))
            Text(node.timing.label)
                .font(.caption2)
                .foregroundStyle(node.timing.accent)
            if !node.station.isEmpty {
                Text("· \(node.station)")
                    .font(.caption2)
                    .foregroundStyle(LariatBrand.inkFaint)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
