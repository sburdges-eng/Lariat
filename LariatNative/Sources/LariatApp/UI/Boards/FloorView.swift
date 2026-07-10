import SwiftUI
import LariatDB
import LariatModel

/// `foh.floor` — the dining-room floor board (web `/floor`). Table tiles
/// colored by the canonical state machine (open → seated → dirty → open;
/// closed out of rotation), a per-table action panel, and the
/// seat-a-reservation flow on open tables.
struct FloorView: View {
    @State private var vm: FloorViewModel
    @State private var query = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: FloorViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, !vm.loaded {
                TileDegrade(title: "Could not load the floor", message: err, systemImage: "externaldrive.badge.xmark")
            } else if vm.loaded {
                boardContent
            } else {
                LaRiOSLoadingView(message: "Loading floor")
            }
        }
        .navigationTitle("Floor")
        .task { vm.start() }
        .tracksActiveBoard(vm.poller)
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

    private var boardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                legend
                if let err = vm.fetchError {
                    LaRiOSInlineBanner(message: err, tone: .bad)
                }
                if let err = vm.actionError {
                    LaRiOSInlineBanner(message: err, tone: .bad)
                }
                if vm.tables.isEmpty {
                    emptyFloor
                } else {
                    HStack(alignment: .top, spacing: 16) {
                        tableGrid
                        if let table = vm.selected {
                            actionPanel(table)
                                .frame(width: 280)
                        }
                    }
                }
            }
            .frame(maxWidth: 1180, alignment: .leading)
            .padding(LaRiOS.Spacing.twelve)
        }
        .scrollContentBackground(.hidden)
        .background(LaRiOS.Colors.background)
        .searchable(text: $query, prompt: "Find a table")
    }

    private var header: some View {
        let c = vm.counts
        return LaRiOSBoardHeader(
            eyebrow: "Front",
            title: "Floor",
            subtitle: "\(c.total) table\(c.total == 1 ? "" : "s") · \(c.seated) seated · \(c.open) open · \(c.dirty) dirty"
        ) {
            LaRiOSChip(text: "\(c.open) open", tone: c.open > 0 ? .ok : .neutral)
        }
        .lariosPanel(padding: LaRiOS.Spacing.eight, fill: LaRiOS.Colors.panelRaised)
    }

    private var legend: some View {
        HStack(spacing: 16) {
            legendItem("Open", statusColor("open"))
            legendItem("Seated", statusColor("seated"))
            legendItem("Dirty", statusColor("dirty"))
            legendItem("Closed", statusColor("closed"))
        }
        .font(LaRiOS.Typography.xsmall)
        .foregroundStyle(LaRiOS.Colors.textMuted)
        .padding(.horizontal, LaRiOS.Spacing.six)
        .padding(.vertical, LaRiOS.Spacing.four)
        .background(LaRiOS.Colors.panel, in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
    }

    private func legendItem(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3)
                .fill(color)
                .frame(width: 14, height: 14)
            Text(label)
        }
    }

    private var emptyFloor: some View {
        VStack(alignment: .leading, spacing: 12) {
            EmptyState(message: "No tables on this floor yet.", systemImage: "tablecells")
            Text("Add starter tables, then rename them later.")
                .font(LaRiOS.Typography.small)
                .foregroundStyle(LaRiOS.Colors.textMuted)
            Button(vm.isBusy ? "Adding…" : "Add a few tables to get started") {
                Task { await vm.addStarterTables() }
            }
            .buttonStyle(.larios(.primary))
            .disabled(vm.isBusy)
            .frame(minHeight: 44)
        }
        .lariosPanel(fill: LaRiOS.Colors.panel)
    }

    private var filteredTables: [DiningTableRow] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return vm.tables }
        return vm.tables.filter {
            $0.id.localizedCaseInsensitiveContains(q) || $0.name.localizedCaseInsensitiveContains(q)
        }
    }

    private var tableGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 10)], spacing: 10) {
            ForEach(filteredTables) { table in
                tableTile(table)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func tableTile(_ table: DiningTableRow) -> some View {
        Button {
            vm.selectedId = table.id == vm.selectedId ? nil : table.id
        } label: {
            VStack(spacing: 4) {
                Text(table.id)
                    .font(LaRiOS.Typography.titleSmall)
                    .lineLimit(1)
                Text("ppl \(table.capacity)")
                    .font(LaRiOS.Typography.xsmall)
                Text(statusLabel(table.status).uppercased())
                    .font(LaRiOS.Typography.eyebrow)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 92)
            .background(statusColor(table.status), in: RoundedRectangle(cornerRadius: LaRiOS.Radius.base))
            .overlay(
                RoundedRectangle(cornerRadius: LaRiOS.Radius.base)
                    .stroke(table.id == vm.selectedId ? LaRiOS.Colors.text : LaRiOS.Colors.hairline.opacity(0.45), lineWidth: table.id == vm.selectedId ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Table \(table.id), \(statusLabel(table.status)), \(table.capacity) seats")
        .accessibilityAddTraits(table.id == vm.selectedId ? [.isSelected] : [])
    }

    private func actionPanel(_ table: DiningTableRow) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(table.id)
                    .font(LaRiOS.Typography.titleSmall)
                    .foregroundStyle(LaRiOS.Colors.text)
                Spacer()
                Button("Close panel") { vm.selectedId = nil }
                    .buttonStyle(.plain)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
            }
            VStack(alignment: .leading, spacing: 12) {
                Text(table.name == table.id ? "ppl \(table.capacity)" : "\(table.name) · ppl \(table.capacity)")
                    .font(LaRiOS.Typography.xsmall)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
                Text(statusLabel(table.status))
                    .font(LaRiOS.Typography.xsmall)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 3)
                    .background(statusColor(table.status), in: Capsule())
                    .foregroundStyle(.white)
            }
            .accessibilityElement(children: .combine)

            // Status verbs gated by the current status — the canonical
            // state machine (FloorCompute.actions).
            VStack(spacing: 6) {
                ForEach(FloorCompute.actions(for: table.status), id: \.target) { action in
                    Button(action.label) {
                        Task { await vm.changeStatus(id: table.id, to: action.target) }
                    }
                    .buttonStyle(.larios(action.isPrimary ? .primary : .secondary))
                    .disabled(vm.isBusy)
                    .frame(maxWidth: .infinity, minHeight: 36)
                }
            }

            if table.status == "open" && !vm.reservations.isEmpty {
                seatReservationSection(table)
            }

            if let notes = table.notes, !notes.isEmpty {
                Divider()
                Text(notes)
                    .font(LaRiOS.Typography.xsmall)
                    .foregroundStyle(LaRiOS.Colors.textMuted)
            }
        }
        .lariosPanel(fill: LaRiOS.Colors.panel)
    }

    private func seatReservationSection(_ table: DiningTableRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LaRiOSSectionHeader(title: "Seat a reservation", tone: .accent)
            if vm.cookStore.cookId == nil {
                Text("Pick a cook to seat reservations.")
                    .font(LaRiOS.Typography.xsmall)
                    .foregroundStyle(LariatTheme.bad)
            }
            ForEach(vm.reservations) { r in
                Button {
                    Task { await vm.seatReservation(reservationId: r.id, tableId: table.id) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.partyName).font(.caption.bold())
                        Text("\(r.partySize) ppl · \(ReservationsCompute.formatRowTime(r.reservationAt))")
                            .font(LaRiOS.Typography.xsmall)
                            .foregroundStyle(LaRiOS.Colors.textMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.larios(.secondary))
                .disabled(vm.isBusy)
            }
        }
    }

    // Status → tile tone. Mirrors STATUS_FILL in FloorPlan.jsx
    // (open green, seated red, dirty orange/amber, closed gray).
    private func statusColor(_ status: String) -> Color {
        switch status {
        case "open": return LariatTheme.ok
        case "seated": return LariatTheme.bad
        case "dirty": return LariatTheme.warn
        case "closed": return .gray
        default: return LariatTheme.ok
        }
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "open": return "Open"
        case "seated": return "Seated"
        case "dirty": return "Dirty"
        case "closed": return "Closed"
        default: return status
        }
    }
}
