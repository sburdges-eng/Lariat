import SwiftUI
import LariatDB
import LariatModel

struct KdsPunchView: View {
    @State private var vm: KdsPunchViewModel
    @State private var orderNumber = ""
    @State private var destination = ""
    @State private var lineItem = ""
    @State private var lineQty = "1"
    @State private var lineStation = KDS_KNOWN_STATIONS.first ?? "grill"
    @State private var lineModifiers = ""
    @State private var draftLines: [KdsPunchLineInput] = []

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: KdsPunchViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load tickets", message: err, systemImage: "tv.badge.wifi")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView("Loading tickets…")
            }
        }
        .navigationTitle("KDS punch")
        .onAppear { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable,
                onDismiss: { vm.showCookPicker = false },
                onCancel: { vm.actionError = "Not saved — pick a cook to send the ticket." }
            )
        }
    }

    /// Send the drafted ticket. Drafts clear ONLY when the write committed;
    /// an identity interrupt stashes this same submit for auto-retry once a
    /// cook is picked (fields stay put on Cancel).
    private func submitPunch() async {
        let ok = await vm.punch(
            orderNumber: orderNumber,
            destination: destination,
            lines: draftLines
        )
        if ok {
            orderNumber = ""
            destination = ""
            draftLines = []
        } else if vm.showCookPicker {
            vm.cookStore.stashPendingWrite { await submitPunch() }
        }
    }

    @ViewBuilder
    private func content(_ snap: KdsBoardSnapshot) -> some View {
        List {
            Section("Open tickets") {
                if let err = vm.bumpError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                if snap.tickets.isEmpty {
                    EmptyState(message: "No open tickets", systemImage: "checkmark.rectangle.stack")
                } else {
                    ForEach(snap.tickets) { ticket in
                        ticketRow(ticket)
                    }
                }
            }

            Section("Add line") {
                TextField("Item", text: $lineItem)
                TextField("Qty", text: $lineQty)
                Picker("Station", selection: $lineStation) {
                    ForEach(KDS_KNOWN_STATIONS, id: \.self) { s in
                        Text(s).tag(s)
                    }
                }
                TextField("Modifiers (optional)", text: $lineModifiers)
                Button("Add line") { addDraftLine() }
                    .disabled(lineItem.trimmingCharacters(in: .whitespaces).isEmpty)
                if !draftLines.isEmpty {
                    ForEach(Array(draftLines.enumerated()), id: \.offset) { idx, line in
                        HStack {
                            Text("\(line.quantity)× \(line.itemName) · \(line.station)")
                            Spacer()
                            Button("Remove") { draftLines.remove(at: idx) }
                                .font(.caption)
                        }
                    }
                }
            }

            Section("Punch ticket") {
                TextField("Order number", text: $orderNumber)
                TextField("Destination (optional)", text: $destination)
                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button(vm.isSaving ? "Sending…" : "Send to line") {
                    Task { await submitPunch() }
                }
                .disabled(vm.isSaving || orderNumber.trimmingCharacters(in: .whitespaces).isEmpty || draftLines.isEmpty)
            }
        }
    }

    @ViewBuilder
    private func ticketRow(_ ticket: KdsOpenTicket) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Order \(ticket.orderNumber)").font(.headline)
                Text(ticket.placedAt).font(.caption).foregroundStyle(.secondary)
                ForEach(ticket.lines) { line in
                    Text("\(line.quantity)× \(line.itemName) · \(line.station)")
                        .font(.subheadline)
                }
            }
            Spacer()
            if let bumpedAt = ticket.bumpedAt {
                Label(bumpedLabel(bumpedAt), systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
            } else {
                Button(vm.isBumping(ticket.id) ? "…" : "Bump") {
                    Task { await vm.bump(ticket.id) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.isBumping(ticket.id))
            }
        }
    }

    private func bumpedLabel(_ iso: String) -> String {
        guard let date = Self.parseIso(iso) else { return "Bumped" }
        return "Bumped \(Self.shortLocalTime.string(from: date))"
    }

    private static func parseIso(_ raw: String) -> Date? {
        let isoFrac = ISO8601DateFormatter()
        isoFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = isoFrac.date(from: raw) { return d }
        return ISO8601DateFormatter().date(from: raw)
    }

    private static let shortLocalTime: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "h:mm a"     // local time zone (formatter default)
        return f
    }()

    private func addDraftLine() {
        let qty = Int(lineQty) ?? 1
        draftLines.append(KdsPunchLineInput(
            itemName: lineItem,
            quantity: max(1, qty),
            station: lineStation,
            modifiers: lineModifiers.isEmpty ? nil : lineModifiers
        ))
        lineItem = ""
        lineQty = "1"
        lineModifiers = ""
    }
}
