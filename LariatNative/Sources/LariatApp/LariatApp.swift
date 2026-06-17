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

    private let sharedDatabase: LariatDatabase? = try? LariatDatabase()
    private let sharedWriteDatabase: LariatWriteDatabase? = try? LariatWriteDatabase()

    var body: some Scene {
        WindowGroup {
            if let db = sharedDatabase, let writeDb = sharedWriteDatabase {
                NavigationSplitView {
                    List(Section.allCases, selection: $selection) { section in
                        Text(section.rawValue).tag(section)
                    }
                    .navigationTitle("Lariat")
                } detail: {
                    NavigationStack {
                        switch selection {
                        case .command:
                            CommandView(database: db)
                        case .analytics:
                            AnalyticsView(database: db)
                        case .costing:
                            CostingView(database: db)
                        case .management:
                            ManagementRollupView(database: db, writeDatabase: writeDb)
                        case nil:
                            Text("Select a section")
                        }
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
