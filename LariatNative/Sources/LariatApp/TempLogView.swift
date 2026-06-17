import SwiftUI
import LariatDB
import LariatModel

struct TempLogView: View {
    @State private var vm: TempLogViewModel
    @State private var pointId = TempLogCompute.points.first?.id ?? ""
    @State private var reading = ""
    @State private var note = ""
    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: TempLogViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load temp log", message: err, systemImage: "thermometer.medium.slash")
            } else if let snap = vm.snapshot {
                boardContent(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Temp log")
        .onAppear { vm.start() }
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
        .sheet(isPresented: $vm.showPinSheet) {
            NavigationStack {
                Form {
                    Section {
                        Text("Manager or temp PIN required to back-date a reading.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        SecureField("PIN", text: $vm.pendingPin)
                    }
                    Section {
                        Button("Confirm") {
                            Task { await vm.submitPinAndRetry() }
                        }
                        .disabled(vm.pendingPin.isEmpty)
                        Button("Cancel", role: .cancel) {
                            vm.cancelPinSheet()
                        }
                    }
                }
                .navigationTitle("Past date PIN")
            }
        }
    }

    @ViewBuilder
    private func boardContent(_ snap: TempLogBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let warning = vm.calibrationWarning {
                    Text(warning)
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
                    ForEach(snap.summary) { tile in
                        tempTile(tile)
                    }
                }

                entryForm
            }
            .padding()
        }
    }

    private func tempTile(_ tile: TempPointSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(tile.label)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            Text(boundLabel(tile))
                .font(.caption)
                .foregroundStyle(.secondary)
            if let last = tile.lastReadingF {
                Text(String(format: "%.1f°F", last))
                    .font(.title3.monospacedDigit())
            } else {
                Text("Not read")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
        .background(tileColor(tile.status).opacity(0.18))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(tileColor(tile.status), lineWidth: 2)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { pointId = tile.pointId }
    }

    private var entryForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Log a reading")
                .font(.headline)
            Picker("Point", selection: $pointId) {
                ForEach(vm.points, id: \.id) { point in
                    Text(point.label).tag(point.id)
                }
            }
            TextField("Temperature °F", text: $reading)
                .textFieldStyle(.roundedBorder)
            if vm.needsCorrectiveNote {
                TextField("What did you do to fix it?", text: $note, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...6)
            }
            if let err = vm.actionError {
                Text(err)
                    .font(.subheadline)
                    .foregroundStyle(.red)
            }
            Button(vm.isSaving ? "Saving…" : "Save reading") {
                Task {
                    await vm.submit(pointId: pointId, readingText: reading, note: note)
                }
            }
            .disabled(vm.isSaving || pointId.isEmpty)
        }
        .padding(.top, 8)
    }

    private func boundLabel(_ tile: TempPointSummary) -> String {
        if let min = tile.requiredMinF, let max = tile.requiredMaxF {
            return "\(Int(min))–\(Int(max))°F"
        }
        if let min = tile.requiredMinF { return "≥ \(Int(min))°F" }
        if let max = tile.requiredMaxF { return "≤ \(Int(max))°F" }
        return ""
    }

    private func tileColor(_ status: TempTileStatus) -> Color {
        switch status {
        case .green: return .green
        case .yellow: return .yellow
        case .red: return .red
        case .gray: return .gray
        }
    }
}
