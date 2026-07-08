import SwiftUI
import LariatDB
import LariatModel

struct CalibrationsView: View {
    @State private var vm: CalibrationsViewModel
    @State private var probeId = ""
    @State private var method: CalibrationMethod = .icePoint
    @State private var reading = ""
    @State private var note = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: CalibrationsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load calibrations", message: err, systemImage: "gauge.with.dots.needle.33percent")
            } else if let snap = vm.snapshot {
                content(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Calibrations")
        .onAppear { vm.start() }
        .tracksActiveBoard(vm.poller)
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
    private func content(_ snap: CalibrationBoardSnapshot) -> some View {
        List {
            if let advisory = vm.advisoryMessage {
                Section {
                    Text(advisory)
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                }
            }

            Section("Log calibration") {
                TextField("Probe id", text: $probeId)
                Picker("Method", selection: $method) {
                    ForEach(CalibrationMethod.allCases) { m in
                        Text(m.label).tag(m)
                    }
                }
                TextField("Reading °F", text: $reading)
                TextField("Note (optional)", text: $note)
                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button(vm.isSaving ? "Saving…" : "Save calibration") {
                    Task { await vm.submit(thermometerId: probeId, method: method, readingText: reading, note: note) }
                }
                .disabled(vm.isSaving || probeId.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            Section("Recent") {
                if snap.rows.isEmpty {
                    Text("No calibrations yet").foregroundStyle(.secondary)
                } else {
                    ForEach(snap.rows) { row in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.thermometerId).font(.headline)
                                Text("\(CalibrationMethod(rawValue: row.method)?.label ?? row.method) · \(row.beforeReadingF.map { String(format: "%.1f°F", $0) } ?? "—")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(row.passed == 1 ? "Pass" : "Fail")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(row.passed == 1 ? .green : .red)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}
