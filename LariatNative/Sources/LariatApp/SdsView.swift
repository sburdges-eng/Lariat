import SwiftUI
import LariatDB
import LariatModel

/// SDS registry screen — parity with `app/food-safety/sds/SdsBoard.jsx`.
/// Lists the active registry (filterable by product / manufacturer / hazard) and
/// registers new Safety Data Sheets via an audited insert.
struct SdsView: View {
    @State private var vm: SdsViewModel
    @State private var productName = ""
    @State private var manufacturer = ""
    @State private var hazardClass = ""
    @State private var storageLocation = ""
    @State private var pdfOrUrl = ""
    @State private var lastReviewed = ""

    init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        _vm = State(wrappedValue: SdsViewModel(readDB: readDB, writeDB: writeDB))
    }

    var body: some View {
        Group {
            if let err = vm.fetchError, vm.snapshot == nil {
                TileDegrade(title: "Could not load SDS registry", message: err, systemImage: "doc.text.magnifyingglass")
            } else if vm.snapshot != nil {
                content
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Safety data sheets")
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

    private var content: some View {
        List {
            Section {
                Text(vm.citation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Registry (\(vm.snapshot?.rows.count ?? 0))") {
                TextField("Filter by product, manufacturer, hazard", text: $vm.filter)
                let rows = vm.filteredRows
                if rows.isEmpty {
                    Text((vm.snapshot?.rows.isEmpty ?? true)
                         ? "No SDS records yet — add one below."
                         : "No matches for that filter.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(rows) { row in
                        registryRow(row)
                    }
                }
            }

            Section("Add SDS") {
                TextField("Product name", text: $productName)
                TextField("Manufacturer (optional)", text: $manufacturer)
                Picker("Hazard class", selection: $hazardClass) {
                    ForEach(vm.hazardClassOptions, id: \.self) { h in
                        Text(h.isEmpty ? "— none —" : h).tag(h)
                    }
                }
                TextField("Storage location (optional)", text: $storageLocation)
                TextField("PDF path or URL (optional)", text: $pdfOrUrl)
                    .autocorrectionDisabled()
                TextField("Last reviewed YYYY-MM-DD (optional)", text: $lastReviewed)
                    .autocorrectionDisabled()

                if let err = vm.actionError {
                    Text(err).font(.caption).foregroundStyle(.red)
                }
                Button(vm.isSaving ? "Saving…" : "Add to registry") {
                    Task { await addToRegistry() }
                }
                .disabled(vm.isSaving || productName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    @ViewBuilder
    private func registryRow(_ row: SdsRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.productName).font(.headline)
            HStack(spacing: 6) {
                if let mfr = row.manufacturer { Text(mfr) }
                if let hz = row.hazardClass {
                    Text(hz)
                        .font(.caption2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            let sheet = row.pdfPath ?? row.url
            HStack(spacing: 12) {
                if let storage = row.storageLocation {
                    Label(storage, systemImage: "archivebox")
                }
                if let sheet {
                    sheetReference(sheet)
                }
                Text("reviewed \(fmtDate(row.lastReviewed))")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    /// The "view" affordance for a registered sheet. http(s) values link directly;
    /// local `pdf_path` values are resolved to a file URL and only rendered as a
    /// link when the file actually exists — otherwise show the raw path as text
    /// so the affordance isn't a lie.
    @ViewBuilder
    private func sheetReference(_ sheet: String) -> some View {
        let lower = sheet.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://"), let url = URL(string: sheet) {
            Link(destination: url) { Label("view", systemImage: "doc") }
        } else if let fileURL = Self.localSheetURL(sheet) {
            Link(destination: fileURL) { Label("view", systemImage: "doc") }
        } else {
            Label(sheet, systemImage: "doc")
        }
    }

    /// Resolve a non-http SDS reference to an openable file URL. Absolute paths
    /// are taken as-is; relative (or web-root-style `/…`) paths are tried against
    /// the Lariat data directory and `LARIAT_ROOT`. Returns nil when no file exists.
    private static func localSheetURL(
        _ path: String,
        env: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        let expanded = (path as NSString).expandingTildeInPath
        if (expanded as NSString).isAbsolutePath, fileManager.fileExists(atPath: expanded) {
            return URL(fileURLWithPath: expanded)
        }
        let relative = expanded.hasPrefix("/") ? String(expanded.dropFirst()) : expanded
        guard !relative.isEmpty else { return nil }
        var bases = [LariatDB.resolveDataDirectory(env: env)]
        if let root = env["LARIAT_ROOT"], !root.trimmingCharacters(in: .whitespaces).isEmpty {
            bases.append(root)
        }
        for base in bases {
            let full = (base as NSString).appendingPathComponent(relative)
            if fileManager.fileExists(atPath: full) {
                return URL(fileURLWithPath: full)
            }
        }
        return nil
    }

    /// Mirrors the web `fmtDate` — first 10 chars (YYYY-MM-DD) or an em dash.
    private func fmtDate(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "—" }
        return String(s.prefix(10))
    }

    private func addToRegistry() async {
        let ok = await vm.register(
            productName: productName,
            manufacturer: manufacturer,
            hazardClass: hazardClass,
            storageLocation: storageLocation,
            pdfOrUrl: pdfOrUrl,
            lastReviewed: lastReviewed
        )
        if ok {
            productName = ""
            manufacturer = ""
            hazardClass = ""
            storageLocation = ""
            pdfOrUrl = ""
            lastReviewed = ""
        }
    }
}
