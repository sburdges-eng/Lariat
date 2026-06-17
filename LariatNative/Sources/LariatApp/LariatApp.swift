import SwiftUI
import LariatDB

@main
struct LariatApp: App {
    @State private var selection: Section? = .command

    enum Section: String, Hashable, CaseIterable, Identifiable {
        case command    = "Command"
        case analytics  = "Analytics"
        case costing    = "Costing"
        case management = "Management"
        var id: String { rawValue }
    }

    /// Single shared database connection opened once at app startup.
    /// On failure every screen receives `nil` and renders its TileDegrade.
    private let sharedDatabase: LariatDatabase? = try? LariatDatabase()

    var body: some Scene {
        WindowGroup {
            if let db = sharedDatabase {
                NavigationSplitView {
                    List(Section.allCases, selection: $selection) { section in
                        Text(section.rawValue).tag(section)
                    }
                    .navigationTitle("Lariat")
                } detail: {
                    switch selection {
                    case .command:    CommandView(database: db)
                    case .analytics:  AnalyticsView(database: db)
                    case .costing:    CostingView(database: db)
                    case .management: ManagementRollupView(database: db)
                    case nil:         Text("Select a section")
                    }
                }
            } else {
                TileDegrade(
                    title: "Database unavailable",
                    message: "Could not open lariat.db at \(resolveDatabasePath()). " +
                             "Check that the web app has created the database and that " +
                             "LARIAT_DATA_DIR is set if needed.",
                    systemImage: "externaldrive.badge.xmark"
                )
            }
        }
    }
}
