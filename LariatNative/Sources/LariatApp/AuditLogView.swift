import SwiftUI
import LariatDB
import LariatModel

/// Native port of `app/management/audit-log/page.jsx` — manager-only review of
/// the management-actions JSONL trail. Read-only by construction: no write
/// APIs are imported; the board renders `ManagementAuditLogReader` output.
struct AuditLogView: View {
    @State private var vm: AuditLogViewModel

    init(reader: ManagementAuditLogReader = ManagementAuditLogReader()) {
        _vm = State(wrappedValue: AuditLogViewModel(reader: reader))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            filterBar

            if vm.loaded && vm.visibleLogs.isEmpty {
                EmptyState(message: "No audit logs found.", systemImage: "doc.text.magnifyingglass")
                    .padding()
                Spacer()
            } else if !vm.loaded {
                ProgressView("Loading audit log…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                logList
                countLabel
            }
        }
        .searchable(text: $vm.searchText, prompt: "Search actions, recipes, users…")
        .navigationTitle("Audit log")
        .task { vm.refresh() }
    }

    @ViewBuilder
    private var filterBar: some View {
        HStack(spacing: 12) {
            Picker("Action", selection: $vm.filterAction) {
                Text("All actions").tag("")
                ForEach(vm.uniqueActions, id: \.self) { action in
                    Text(action).tag(action)
                }
            }
            .frame(maxWidth: 260)
            .onChange(of: vm.filterAction) { _, _ in vm.refresh() }

            Picker("Recipe", selection: $vm.filterSlug) {
                Text("All recipes").tag("")
                ForEach(vm.uniqueSlugs, id: \.self) { slug in
                    Text(slug).tag(slug)
                }
            }
            .frame(maxWidth: 260)
            .onChange(of: vm.filterSlug) { _, _ in vm.refresh() }

            Spacer()

            Button("Refresh") { vm.refresh() }
        }
        .padding()
    }

    @ViewBuilder
    private var logList: some View {
        List(vm.visibleLogs) { entry in
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(entry.action ?? "—")
                            .font(.caption.bold())
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(LariatTheme.amber.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))

                        Text(entry.slug ?? "—")
                            .foregroundStyle(entry.slug == nil ? .secondary : .primary)

                        if let user = entry.user {
                            Text(user).foregroundStyle(.secondary)
                        }

                        Spacer()

                        Text(vm.displayTimestamp(entry))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)

                    if !entry.changes.isEmpty {
                        Button(vm.expandedId == entry.id ? "Hide" : "Show") {
                            vm.toggleExpanded(entry.id)
                        }
                        .buttonStyle(.borderless)
                        .font(.caption.bold())
                    }
                }

                if vm.expandedId == entry.id && !entry.changes.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Changes:").font(.caption.bold())
                        ForEach(entry.changes, id: \.key) { change in
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text("\(change.key):").font(.system(.caption, design: .monospaced).bold())
                                Text(change.value).font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.leading, 8)
                    .padding(.vertical, 4)
                }
            }
            .padding(.vertical, 2)
        }
        .listStyle(.inset)
    }

    @ViewBuilder
    private var countLabel: some View {
        Text("Showing \(vm.visibleLogs.count) audit log \(vm.visibleLogs.count == 1 ? "entry" : "entries")")
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal)
            .padding(.bottom, 8)
    }
}
