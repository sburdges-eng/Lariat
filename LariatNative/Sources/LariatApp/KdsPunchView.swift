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
                ProgressView()
            }
        }
        .navigationTitle("KDS punch")
        .onAppear { vm.start() }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.showCookPicker) {
            CookIdentityPicker(
                store: vm.cookStore,
                staff: vm.staff,
                staffUnavailable: vm.staffUnavailable
            ) { vm.showCookPicker = false }
        }
    }

    @ViewBuilder
    private func content(_ snap: KdsBoardSnapshot) -> some View {
        List {
            Section("Open tickets") {
                if snap.tickets.isEmpty {
                    Text("No open tickets").foregroundStyle(.secondary)
                } else {
                    ForEach(snap.tickets) { ticket in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Order \(ticket.orderNumber)").font(.headline)
                            Text(ticket.placedAt).font(.caption).foregroundStyle(.secondary)
                            ForEach(ticket.lines) { line in
                                Text("\(line.quantity)× \(line.itemName) · \(line.station)")
                                    .font(.subheadline)
                            }
                        }
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
                    Task {
                        await vm.punch(
                            orderNumber: orderNumber,
                            destination: destination,
                            lines: draftLines
                        )
                        if vm.actionError == nil {
                            orderNumber = ""
                            destination = ""
                            draftLines = []
                        }
                    }
                }
                .disabled(vm.isSaving || orderNumber.trimmingCharacters(in: .whitespaces).isEmpty || draftLines.isEmpty)
            }
        }
    }

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
