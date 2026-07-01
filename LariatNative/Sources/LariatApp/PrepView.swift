import SwiftUI
import LariatDB
import LariatModel

/// Cook-tier prep board — native port of app/prep (PrepBoard.jsx + page.jsx).
/// Add tasks, claim/start/done/skip in place, drop tasks. Open tasks group by
/// station; done/skipped fall to a closed bin.
struct PrepView: View {
    @State private var vm: PrepViewModel
    @State private var task = ""
    @State private var stationId = ""
    @State private var qty = ""
    @State private var priority: PrepPriority = .normal
    @State private var notes = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, stations: [KitchenStation]) {
        _vm = State(wrappedValue: PrepViewModel(readDB: readDB, writeDB: writeDB, stations: stations))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load prep", message: err, systemImage: "externaldrive.badge.xmark")
            } else if let snap = vm.snapshot {
                boardContent(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Prep")
        .task { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable
            ) {
                vm.showCookPicker = false
            }
        }
    }

    @ViewBuilder
    private func boardContent(_ snap: PrepBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header(snap)
                addForm
                if let err = vm.actionError {
                    Text(err).font(.subheadline).foregroundStyle(.red)
                }
                if snap.openGroups.isEmpty {
                    Text("Nothing on the board yet.")
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
                ForEach(snap.openGroups) { group in
                    stationSection(group)
                }
                if !snap.closed.isEmpty {
                    closedSection(snap.closed)
                }
            }
            .padding()
        }
    }

    private func header(_ snap: PrepBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Prep board").font(.largeTitle.bold())
            Text(subtitle(snap.counts))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func subtitle(_ c: PrepStatusCounts) -> String {
        if c.todo == 0 { return "What the line is prepping today." }
        return "\(c.todo) to do · \(c.inProgress) in progress · \(c.done) done."
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add a task").font(.headline)
            TextField("e.g. Prep aji verde, dice tomato mise", text: $task)
                .textFieldStyle(.roundedBorder)
            Picker("Station", selection: $stationId) {
                Text("Any station").tag("")
                ForEach(vm.stationOptions, id: \.id) { station in
                    Text(station.name).tag(station.id)
                }
            }
            TextField("Qty (2 qt, 6 ea)", text: $qty)
                .textFieldStyle(.roundedBorder)
            Picker("Priority", selection: $priority) {
                ForEach(PrepPriority.allCases) { level in
                    Text(level.label.capitalized).tag(level)
                }
            }
            TextField("Notes (optional)", text: $notes)
                .textFieldStyle(.roundedBorder)
            Button(vm.isSaving ? "Saving…" : "Add") {
                Task {
                    await vm.add(task: task, stationId: stationId, qty: qty, priority: priority, notes: notes)
                    if vm.actionError == nil {
                        task = ""
                        qty = ""
                        notes = ""
                        priority = .normal
                    }
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(vm.isSaving || task.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .frame(minHeight: 44)
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private func stationSection(_ group: PrepStationGroup) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(group.stationName) · \(group.tasks.count)").font(.headline)
            ForEach(group.tasks) { row in
                taskRow(row)
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func taskRow(_ row: PrepTaskRow) -> some View {
        let busy = vm.isBusy(row.id)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(row.task).font(.headline)
                        if let qty = row.qty, !qty.isEmpty {
                            Text(qty).font(.subheadline).foregroundStyle(.secondary)
                        }
                        priorityBadge(row.priorityLevel)
                    }
                    Text(metaLine(row)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            actionButtons(row, busy: busy)
        }
        .padding(10)
        .background(rowBackground(row.priorityLevel), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private func priorityBadge(_ level: PrepPriority) -> some View {
        if level != .normal {
            Text(level.label)
                .font(.caption2.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(level == .rush ? Color.red : Color.orange, in: Capsule())
        }
    }

    private func rowBackground(_ level: PrepPriority) -> some ShapeStyle {
        switch level {
        case .rush: return AnyShapeStyle(.red.opacity(0.12))
        case .high: return AnyShapeStyle(.orange.opacity(0.12))
        case .normal: return AnyShapeStyle(.background.opacity(0.35))
        }
    }

    private func metaLine(_ row: PrepTaskRow) -> String {
        var parts: [String] = []
        if let cook = row.assignedCookId, !cook.isEmpty { parts.append(cook) } else { parts.append("unclaimed") }
        if let notes = row.notes, !notes.isEmpty { parts.append(notes) }
        if let source = row.source, source != "manual", !source.isEmpty { parts.append("from \(source)") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func actionButtons(_ row: PrepTaskRow, busy: Bool) -> some View {
        HStack(spacing: 8) {
            if row.statusValue == .todo && (row.assignedCookId?.isEmpty ?? true) {
                Button(vm.cookId != nil ? "Claim" : "Set cook first") {
                    Task { await vm.claim(row.id) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
            }
            if row.statusValue == .todo && !(row.assignedCookId?.isEmpty ?? true) {
                Button("Start") { Task { await vm.setStatus(row.id, .inProgress) } }
                    .buttonStyle(.bordered)
                    .disabled(busy)
                if isMine(row) {
                    Button("Drop claim") { Task { await vm.releaseClaim(row.id) } }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                }
            }
            if row.statusValue == .inProgress {
                Button("Done") { Task { await vm.setStatus(row.id, .done) } }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy)
                Button("Skip") { Task { await vm.setStatus(row.id, .skipped) } }
                    .buttonStyle(.bordered)
                    .disabled(busy)
            }
            Button(role: .destructive) {
                Task { await vm.delete(row.id) }
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.bordered)
            .disabled(busy)
            .accessibilityLabel("Drop \(row.task)")
        }
        .frame(minHeight: 44)
    }

    private func isMine(_ row: PrepTaskRow) -> Bool {
        guard let assigned = row.assignedCookId, let cook = vm.cookId else { return false }
        return assigned == cook
    }

    private func closedSection(_ rows: [PrepTaskRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Done · \(rows.count)").font(.headline)
            ForEach(rows) { row in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.task)
                            .strikethrough(row.statusValue == .skipped)
                        Text(closedMeta(row)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Reopen") { Task { await vm.setStatus(row.id, .todo) } }
                        .buttonStyle(.bordered)
                        .disabled(vm.isBusy(row.id))
                }
                .padding(8)
                .background(.background.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding()
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    private func closedMeta(_ row: PrepTaskRow) -> String {
        var parts: [String] = [row.statusValue == .skipped ? "skipped" : "done"]
        if let by = row.doneBy, !by.isEmpty { parts.append("by \(by)") }
        return parts.joined(separator: " · ")
    }
}
