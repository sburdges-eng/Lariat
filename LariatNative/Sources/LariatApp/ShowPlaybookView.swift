import SwiftUI
import LariatDB
import LariatModel
import Observation

/// Playbook — native port of `app/playbook` (PlaybookHeader + the four
/// marketing-checklist tabs: Ad checklist / Tickets / Newsletter / Day of
/// event). READ-ONLY, exactly like the web page: every cell renders a
/// `StatusPill` from the show's `status_json` via `ShowStatusCompute`
/// (`lib/showStatus.ts` parity — unknown vocabulary renders green, never
/// red; Lauren's sheet is SoT). PIN-gated whole-board (`/playbook` is a web
/// SENSITIVE_PREFIX). The header's "Event ops" links navigate to the
/// stage / sound / box-office / settlement boards via `AppContext.navigate`.
struct ShowPlaybookView: View {
    @State private var gateModel: ShowsGateModel
    @State private var picker: ShowPickerModel
    @State private var vm: ShowPlaybookViewModel
    private let navigate: (String) -> Void

    init(
        database: LariatDatabase,
        writeDatabase: LariatWriteDatabase?,
        navigate: @escaping (String) -> Void
    ) {
        _gateModel = State(wrappedValue: ShowsGateModel(
            database: database, writeDatabase: writeDatabase))
        _picker = State(wrappedValue: ShowPickerModel(database: database))
        _vm = State(wrappedValue: ShowPlaybookViewModel())
        self.navigate = navigate
    }

    var body: some View {
        ShowsGatedBoard(gateModel: gateModel, title: "Playbook") {
            content
                .task {
                    await picker.load()
                    vm.start(picker: picker)
                }
                .onDisappear { vm.stop() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !picker.hasLoaded {
            ProgressView("Loading shows…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if picker.shows.isEmpty {
            // Web parity: the no-show state, or the picker's load failure.
            VStack(spacing: 8) {
                if let loadError = picker.loadError {
                    TileDegrade(
                        title: "Couldn't load shows",
                        message: loadError,
                        systemImage: "music.mic"
                    )
                } else {
                    TileDegrade(
                        title: "No upcoming shows",
                        message: "Nothing on the books yet — pull fresh after Lauren updates the booking sheet.",
                        systemImage: "music.mic"
                    )
                }
            }
        } else {
            List {
                Section { ShowPickerRow(model: picker) }
                if let show = picker.selectedShow {
                    header(show)
                    Section {
                        Picker("", selection: $vm.tab) {
                            ForEach(ShowPlaybookViewModel.Tab.allCases) { tab in
                                Text(tab.label).tag(tab)
                            }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                    }
                    checklistSection(show)
                    eventOpsSection
                } else {
                    Section {
                        EmptyState(message: "Pick a show to open its playbook.", systemImage: "music.mic")
                    }
                }
            }
        }
    }

    // ── header (PlaybookHeader parity) ────────────────────────────────

    @ViewBuilder
    private func header(_ show: ShowRow) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text("SHOW MARKETING · PLAYBOOK")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .kerning(2)
                Text(show.bandName).font(.title2).bold()
                Text(show.showDate).font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    // ── tabs (AdsTab / TicketsTab / NewsTab / DayOfTab parity) ────────

    @ViewBuilder
    private func checklistSection(_ show: ShowRow) -> some View {
        let status = show.status
        switch vm.tab {
        case .ads:
            Section("Ad checklist") {
                ForEach(ShowPlaybookViewModel.adsFields, id: \.key) { field in
                    pillRow(field.label, status[field.key], column: field.key)
                }
            }
        case .tickets:
            Section("Tickets") {
                HStack {
                    Text("Advance ticket price")
                    Spacer()
                    Text(show.price.map { formatDollars($0, decimals: 2) } ?? "—")
                        .monospacedDigit()
                }
                .font(.callout)
                statusPillRow(
                    "Door price (door tix)",
                    ShowStatusCompute.statusColor(show.doorTix, "door_tix"),
                    column: "door_tix",
                    rawValue: show.doorTix
                )
                pillRow("DICE tickets created", status["create_dice_tickets"], column: "create_dice_tickets")
                pillRow("Co-host sent", status["co_host_sent"], column: "co_host_sent")
            }
        case .news:
            Section("Newsletter") {
                pillRow("Newsletter included", status["newsletter"], column: "newsletter")
                pillRow("Announce date", status["announce_date"], column: "announce_date")
            }
        case .dayof:
            Section("Day of") {
                ForEach(ShowPlaybookViewModel.dayOfFields, id: \.key) { field in
                    pillRow(field.label, status[field.key], column: field.key)
                }
            }
        }
    }

    /// Web `Event ops:` strip — cross-board navigation by stable feature id.
    @ViewBuilder
    private var eventOpsSection: some View {
        Section("Event ops") {
            HStack(spacing: 8) {
                Button("Stage") { navigate("shows.stage") }
                Button("Sound") { navigate("shows.sound") }
                Button("Box office") { navigate("shows.boxOffice") }
                Button("Settlement") { navigate("shows.settlement") }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    // ── StatusPill parity ─────────────────────────────────────────────

    @ViewBuilder
    private func pillRow(_ label: String, _ value: ShowStatusValue?, column: String) -> some View {
        statusPillRow(
            label,
            ShowStatusCompute.statusColor(value, column),
            column: column,
            rawValue: value.map { $0.jsString }
        )
    }

    @ViewBuilder
    private func statusPillRow(
        _ label: String, _ badge: ShowStatusBadge, column: String, rawValue: String?
    ) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(badge.label)
                .font(.caption)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(pillColor(badge.color).opacity(0.15), in: Capsule())
                .foregroundStyle(pillColor(badge.color))
                .help("\(column): \(rawValue ?? "—")")
        }
        .font(.callout)
    }

    private func pillColor(_ color: ShowStatusColor) -> Color {
        switch color {
        case .green: return LariatTheme.ok
        case .amber: return LariatTheme.warn
        case .red: return LariatTheme.bad
        case .neutral: return LariatTheme.muted
        }
    }
}

/// Playbook view model — tab state + a poll that keeps the show list (and
/// with it the status pills) fresh. The board itself is read-only; all data
/// renders straight off the picker's `ShowRow`s.
@Observable @MainActor
final class ShowPlaybookViewModel {
    /// Web tab keys/order: ads · tickets · news · dayof (default ads).
    enum Tab: String, CaseIterable, Identifiable {
        case ads, tickets, news, dayof
        var id: String { rawValue }

        var label: String {
            switch self {
            case .ads: return "Ad checklist"
            case .tickets: return "Tickets"
            case .news: return "Newsletter"
            case .dayof: return "Day of event"
            }
        }
    }

    var tab: Tab = .ads

    /// AdsTab FIELDS, verbatim labels.
    static let adsFields: [(key: String, label: String)] = [
        ("media_list", "Media list"),
        ("mkting_adv", "Marketing advance"),
        ("meta_ads", "Meta ads"),
        ("fb_event", "FB event"),
        ("listing_jambase_bit_songkick", "Jambase / BIT / Songkick"),
    ]

    /// DayOfTab FIELDS, verbatim labels.
    static let dayOfFields: [(key: String, label: String)] = [
        ("dice_email", "DICE email (tix, DOS)"),
        ("assets", "Assets ready"),
        ("posts", "Posts"),
        ("whbv", "WHBV"),
    ]

    private let poller = BoardPoller()
    private weak var picker: ShowPickerModel?

    func start(picker: ShowPickerModel) {
        self.picker = picker
        poller.start(interval: .seconds(5)) { [weak self] in
            guard let self, let picker = self.picker else { return }
            await picker.load()
            try BoardPoller.throwIfFailed(picker.loadError)
        }
    }

    func stop() { poller.stop() }
}
