import SwiftUI
import LariatDB
import LariatModel

struct EightySixView: View {
    @State private var vm: EightySixViewModel
    @State private var item = ""
    @State private var stationId = ""
    @State private var reason: EightySixReasonCode = .out
    @State private var quantity = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, catalog: StationCatalog) {
        _vm = State(
            wrappedValue: EightySixViewModel(readDB: readDB, writeDB: writeDB, catalog: catalog)
        )
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load 86", message: err, systemImage: "externaldrive.badge.xmark")
            } else if let snap = vm.snapshot {
                boardContent(snap)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("86")
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
    private func boardContent(_ snap: EightySixBoardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header(snap)
                addForm
                if let err = vm.actionError {
                    Text(err).font(.subheadline).foregroundStyle(.red)
                }
                if !snap.cascaded.isEmpty {
                    cascadeSection(snap.cascaded)
                }
                activeSection(snap.active)
                if !snap.resolved.isEmpty {
                    resolvedSection(snap.resolved)
                }
            }
            .padding()
        }
    }

    private func header(_ snap: EightySixBoardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("86 board")
                .font(.largeTitle.bold())
            Text(openLabel(snap.active.count))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mark out").font(.headline)
            TextField("Item", text: $item)
                .textFieldStyle(.roundedBorder)
            Picker("Station", selection: $stationId) {
                Text("Any station").tag("")
                ForEach(vm.stations, id: \.id) { station in
                    Text(station.name).tag(station.id)
                }
            }
            Picker("Reason", selection: $reason) {
                ForEach(EightySixReasonCode.allCases) { code in
                    Text(code.label).tag(code)
                }
            }
            TextField("Qty (optional)", text: $quantity)
                .textFieldStyle(.roundedBorder)
            Button(vm.isSaving ? "Saving…" : "86 now") {
                Task {
                    await vm.add(item: item, stationId: stationId, reason: reason, quantity: quantity)
                    if vm.actionError == nil {
                        item = ""
                        quantity = ""
                    }
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(vm.isSaving || item.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .frame(minHeight: 44)
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private func cascadeSection(_ cascaded: [CascadedRecipe]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Also hits the menu").font(.headline)
            ForEach(cascaded, id: \.slug) { recipe in
                if vm.confirmCascade?.slug == recipe.slug {
                    HStack {
                        Text(recipe.name)
                        Spacer()
                        Button("Confirm") {
                            Task { await vm.confirmCascadeAdd(recipe) }
                        }
                        .buttonStyle(.borderedProminent)
                        Button("Cancel") { vm.confirmCascade = nil }
                    }
                } else {
                    Button {
                        vm.confirmCascade = recipe
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(recipe.name).font(.headline)
                                Text("via \(recipe.via)").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "plus.circle")
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding()
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }

    private func activeSection(_ rows: [EightySixRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Out now").font(.headline)
            if rows.isEmpty {
                Text("Nothing out right now").foregroundStyle(.secondary)
            } else {
                ForEach(rows) { row in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.item).font(.headline)
                            if let reason = row.reason, !reason.isEmpty {
                                Text(reason).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button(vm.isResolving(row.id) ? "…" : "Back on menu") {
                            Task { await vm.resolve(id: row.id) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(vm.isResolving(row.id))
                    }
                    .padding(10)
                    .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding()
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
    }

    private func resolvedSection(_ rows: [EightySixRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Resolved today (\(rows.count))").font(.headline)
            ForEach(rows) { row in
                HStack {
                    Text(row.item)
                    Spacer()
                    if let resolved = row.resolvedAt {
                        Text(resolved).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(8)
                .background(.background.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding()
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    private func openLabel(_ count: Int) -> String {
        count == 1 ? "1 item out" : "\(count) items out"
    }
}
