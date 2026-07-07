import AppKit
import SwiftUI
import LariatDB
import LariatModel

/// Native port of `/equipment` — gear, parts, schedules, manuals, and what
/// it's costing. Expandable cards with Details / Parts / Schedule / Log
/// tabs, matching `EquipmentBoard.tsx`. Open surface: no PIN; writes post
/// no audit_events (web parity). The manual link opens the local file the
/// web serves as `/{manual_path}` (http(s) values open in the browser).
struct EquipmentView: View {
    @State private var vm: EquipmentViewModel

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: EquipmentViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.equipment.isEmpty {
                TileDegrade(title: "Could not load equipment", message: err, systemImage: "wrench.and.screwdriver")
            } else if !vm.loaded {
                ProgressView("Loading equipment…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
        .navigationTitle("Equipment")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
        .onDisappear { vm.stop() }
        .toolbar {
            ToolbarItem {
                Button("Add a piece") { vm.showAddEquipment = true }
            }
        }
        .sheet(isPresented: $vm.showAddEquipment) { addEquipmentForm }
    }

    @ViewBuilder
    private var content: some View {
        List {
            if let e = vm.actionError {
                Text(e).font(.callout).foregroundStyle(LariatTheme.bad)
            }
            if vm.equipment.isEmpty {
                EmptyState(message: "Nothing here yet.", systemImage: "wrench.and.screwdriver")
            } else {
                ForEach(vm.visibleEquipment) { item in
                    equipmentCard(item)
                }
                if vm.visibleEquipment.isEmpty {
                    EmptyState(message: "No equipment matches the search.", systemImage: "magnifyingglass")
                }
            }
        }
        .searchable(text: $vm.searchText, prompt: "Search equipment")
    }

    // ── card ────────────────────────────────────────────────────────────

    @ViewBuilder
    private func equipmentCard(_ item: EquipmentRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                vm.toggleExpand(item.id)
            } label: {
                cardHeader(item)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(vm.expandedId == item.id ? [.isSelected] : [])

            if vm.expandedId == item.id {
                Divider()
                Picker("Tab", selection: $vm.activeTab) {
                    ForEach(EquipmentViewModel.DetailTab.allCases, id: \.self) { tab in
                        Text(tabLabel(tab, item: item)).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                switch vm.activeTab {
                case .details: detailsTab(item)
                case .parts: partsTab(item)
                case .schedule: scheduleTab(item)
                case .log: logTab(item)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func tabLabel(_ tab: EquipmentViewModel.DetailTab, item: EquipmentRow) -> String {
        switch tab {
        case .parts: return "Parts (\(vm.partsFor(item.id).count))"
        case .schedule: return "Schedule (\(vm.scheduleFor(item.id).count))"
        default: return tab.rawValue
        }
    }

    @ViewBuilder
    private func cardHeader(_ item: EquipmentRow) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(item.name).font(.callout.weight(.bold))
                Text(headerMeta(item))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                (Text(formatDollars(item.maintenanceCost, decimals: 2)).bold().foregroundStyle(LariatTheme.bad)
                    + Text(" Maint").foregroundStyle(.secondary))
                    .font(.caption)
                if let cost = item.purchaseCost {
                    Text("\(formatDollars(cost, decimals: 2)) Capital")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let warranty = item.warrantyExpiration {
                    let expired = EquipmentCompute.isPastDate(warranty)
                    Text("Warranty: \(longDate(warranty))\(expired ? " (expired)" : "")")
                        .font(.caption2)
                        .foregroundStyle(expired ? LariatTheme.bad : Color.secondary)
                }
                if vm.isOverdue(item.id) {
                    Text("Service overdue")
                        .font(.caption2.bold())
                        .foregroundStyle(LariatTheme.bad)
                }
                let partCount = vm.partsFor(item.id).count
                if partCount > 0 {
                    Text("\(partCount) part\(partCount == 1 ? "" : "s") on file")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func headerMeta(_ item: EquipmentRow) -> String {
        var parts = [item.category]
        if let m = item.makeModel, !m.isEmpty { parts.append(m) }
        if let m = item.modelNumber, !m.isEmpty { parts.append("Model \(m)") }
        if let s = item.serialNumber, !s.isEmpty { parts.append("SN \(s)") }
        if let v = item.vendor, !v.isEmpty { parts.append(v) }
        return parts.joined(separator: " · ")
    }

    // ── tabs ────────────────────────────────────────────────────────────

    @ViewBuilder
    private func detailsTab(_ item: EquipmentRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let ref = item.vendorOrderRef, !ref.isEmpty {
                Text("Order/invoice: ").font(.caption).foregroundStyle(.secondary) + Text(ref).font(.caption.bold())
            }
            if let purchased = item.purchaseDate, !purchased.isEmpty {
                Text("Purchased: \(longDate(purchased))").font(.caption).foregroundStyle(.secondary)
            }
            if let manual = item.manualPath, !manual.isEmpty {
                manualRow(manual)
            }
            if let notes = item.notes, !notes.isEmpty {
                Text(notes).font(.caption).padding(.top, 4)
            }
            if (item.vendorOrderRef ?? "").isEmpty, (item.purchaseDate ?? "").isEmpty,
               (item.manualPath ?? "").isEmpty, (item.notes ?? "").isEmpty {
                Text("No extra details recorded yet.")
                    .font(.caption)
                    .italic()
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Web parity for `<a href="/{manual_path}" target=_blank>`: http(s)
    /// values open in the browser; repo-relative paths open the local file
    /// via NSWorkspace; a missing file shows a dimmed not-found hint
    /// instead of a dead link.
    @ViewBuilder
    private func manualRow(_ manual: String) -> some View {
        if let webURL = EquipmentViewModel.manualWebURL(manual) {
            Link(destination: webURL) {
                Label("Manual: \(manual)", systemImage: "book")
            }
            .font(.caption)
        } else if let fileURL = EquipmentViewModel.manualFileURL(manual) {
            Button {
                NSWorkspace.shared.open(fileURL)
            } label: {
                Label("Manual: \(manual)", systemImage: "book")
                    .foregroundStyle(.tint)
            }
            .buttonStyle(.plain)
            .font(.caption)
            .accessibilityLabel("Open the manual for this equipment")
        } else {
            Text("Manual: \(manual) — file not found")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private func partsTab(_ item: EquipmentRow) -> some View {
        let itemParts = vm.partsFor(item.id)
        VStack(alignment: .leading, spacing: 8) {
            if itemParts.isEmpty {
                Text("No parts on file.").font(.caption).italic().foregroundStyle(.secondary)
            }
            ForEach(itemParts) { part in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(part.partNumber)\(part.description.map { " — \($0)" } ?? "")")
                        .font(.caption.weight(.semibold))
                    Text(partMeta(part))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let notes = part.notes, !notes.isEmpty {
                        Text(notes).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            if vm.addPartFor == item.id {
                addPartForm(item)
            } else {
                Button("+ Add a part") { vm.addPartFor = item.id }
                    .font(.caption)
            }
        }
    }

    private func partMeta(_ part: EquipmentPartRow) -> String {
        var bits: [String] = []
        if let v = part.vendor, !v.isEmpty { bits.append(v) }
        if let price = part.unitPrice { bits.append("\(formatDollars(price, decimals: 2)) ea") }
        if let qty = part.qtyOnHand { bits.append("\(qtyString(qty)) on hand") }
        if let ordered = part.lastOrdered, !ordered.isEmpty { bits.append("last ordered \(longDate(ordered))") }
        if let ref = part.lastOrderRef, !ref.isEmpty { bits.append("(\(ref))") }
        return bits.joined(separator: " · ")
    }

    @ViewBuilder
    private func scheduleTab(_ item: EquipmentRow) -> some View {
        let rows = vm.scheduleFor(item.id)
        VStack(alignment: .leading, spacing: 8) {
            if rows.isEmpty {
                Text("No scheduled maintenance.").font(.caption).italic().foregroundStyle(.secondary)
            }
            ForEach(rows) { row in
                let overdue = EquipmentCompute.isPastDate(row.nextDue)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.task).font(.caption.weight(.semibold))
                    Text(scheduleMeta(row, overdue: overdue))
                        .font(.caption2)
                        .foregroundStyle(overdue ? LariatTheme.bad : Color.secondary)
                    if let notes = row.notes, !notes.isEmpty {
                        Text(notes).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            if vm.addSchedFor == item.id {
                addScheduleForm(item)
            } else {
                Button("+ Add scheduled task") { vm.addSchedFor = item.id }
                    .font(.caption)
            }
        }
    }

    private func scheduleMeta(_ row: EquipmentScheduleRow, overdue: Bool) -> String {
        var s = "Every \(row.frequency.lowercased())"
        if let last = row.lastDone, !last.isEmpty { s += " · last done \(longDate(last))" }
        if let due = row.nextDue, !due.isEmpty { s += " · next due \(longDate(due))" }
        if overdue { s += " (overdue)" }
        return s
    }

    @ViewBuilder
    private func logTab(_ item: EquipmentRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Type", selection: $vm.mType) {
                ForEach(EquipmentFormOptions.maintenanceTypes, id: \.self) { Text($0) }
            }
            TextField("Cost $", text: $vm.mCostText)
            TextField("What happened (e.g. Replaced compressor relay)", text: $vm.mNotes)
            TextField("Receipt or invoice number", text: $vm.mReceipt)
            Button("Log") { vm.logMaintenance(equipmentId: item.id) }
                .disabled(vm.isSaving || vm.mCostText.isEmpty || vm.mNotes.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .font(.caption)
    }

    // ── forms ───────────────────────────────────────────────────────────

    @ViewBuilder
    private var addEquipmentForm: some View {
        NavigationStack {
            Form {
                TextField("Name (e.g. Rational Alto Shaam)", text: $vm.name)
                Picker("Category", selection: $vm.category) {
                    ForEach(EquipmentFormOptions.categories, id: \.self) { Text($0) }
                }
                TextField("Make / Model (e.g. Vulcan VC44GD)", text: $vm.makeModel)
                TextField("Model number", text: $vm.modelNumber)
                TextField("Serial number", text: $vm.serial)
                TextField("Vendor (WebstaurantStore, Sysco, …)", text: $vm.vendor)
                TextField("Order / invoice #", text: $vm.orderRef)
                TextField("Purchase cost $", text: $vm.costText)
                TextField("Purchased on (YYYY-MM-DD)", text: $vm.purchaseDate)
                TextField("Warranty until (YYYY-MM-DD)", text: $vm.warranty)
                TextField("Manual (file path or URL)", text: $vm.manualPath)
                TextField("Notes (quirks, install notes, gas line, breaker)", text: $vm.notes)
                if let e = vm.actionError {
                    Text(e).font(.caption).foregroundStyle(LariatTheme.bad)
                }
            }
            .navigationTitle("Add a piece")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { vm.showAddEquipment = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { vm.addEquipment() }
                        .disabled(vm.isSaving || vm.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .frame(minWidth: 420, minHeight: 520)
    }

    @ViewBuilder
    private func addPartForm(_ item: EquipmentRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Part number", text: $vm.pPartNum)
            TextField("Description (e.g. compressor relay)", text: $vm.pDesc)
            TextField("Vendor", text: $vm.pVendor)
            TextField("Unit $", text: $vm.pUnitPriceText)
            TextField("Qty on hand", text: $vm.pQtyText)
            TextField("Last ordered (YYYY-MM-DD)", text: $vm.pOrdered)
            TextField("Order ref", text: $vm.pOrderRef)
            TextField("Notes", text: $vm.pNotes)
            HStack {
                Button("Save part") { vm.addPart(equipmentId: item.id) }
                    .disabled(vm.isSaving || vm.pPartNum.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel", role: .cancel) { vm.addPartFor = nil }
            }
        }
        .font(.caption)
    }

    @ViewBuilder
    private func addScheduleForm(_ item: EquipmentRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Task (e.g. Change fryer filter)", text: $vm.sTask)
            Picker("Frequency", selection: $vm.sFreq) {
                ForEach(EquipmentFormOptions.frequencies, id: \.self) { Text($0) }
            }
            TextField("Last done (YYYY-MM-DD)", text: $vm.sLastDone)
            TextField("Next due (YYYY-MM-DD)", text: $vm.sNextDue)
            TextField("Notes", text: $vm.sNotes)
            HStack {
                Button("Save schedule") { vm.addSchedule(equipmentId: item.id) }
                    .disabled(vm.isSaving || vm.sTask.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel", role: .cancel) { vm.addSchedFor = nil }
            }
        }
        .font(.caption)
    }

    // ── formatting ──────────────────────────────────────────────────────

    private func qtyString(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(v)
    }

    /// `formatDate` parity: 'MMM d, yyyy' from a YYYY-MM-DD string;
    /// unparseable values echo through.
    private func longDate(_ iso: String) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let date = fmt.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_US")
        out.dateFormat = "MMM d, yyyy"
        return out.string(from: date)
    }
}
