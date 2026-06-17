import SwiftUI
import LariatDB

@main
struct LariatApp: App {
  @State private var selection: SidebarSelection = .cook(.today)

  enum SidebarSelection: Hashable {
    case cook(CookDestination)
    case manager(ManagerSection)
  }

  enum ManagerSection: String, Hashable, CaseIterable, Identifiable {
    case command = "Command"
    case analytics = "Analytics"
    case costing = "Costing"
    case management = "Management"
    var id: String { rawValue }
  }

  private let sharedDatabase: LariatDatabase?
  private let sharedWriteDatabase: LariatWriteDatabase?

  init() {
    let path = resolveDatabasePath()
    sharedDatabase = try? LariatDatabase(path: path)
    sharedWriteDatabase = try? LariatWriteDatabase(path: path)
  }

  var body: some Scene {
    WindowGroup {
      if let db = sharedDatabase {
        NavigationSplitView {
          List(selection: $selection) {
            Section("Cook") {
              ForEach(CookDestination.allCases) { dest in
                if dest.enabled {
                  Text(dest.rawValue).tag(SidebarSelection.cook(dest))
                } else {
                  Text(dest.rawValue)
                    .foregroundStyle(.tertiary)
                    .badge("Soon")
                }
              }
            }
            Section("Manager") {
              ForEach(ManagerSection.allCases) { section in
                Text(section.rawValue).tag(SidebarSelection.manager(section))
              }
            }
          }
          .navigationTitle("Lariat")
        } detail: {
          NavigationStack {
            detailView(database: db)
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

  @ViewBuilder
  private func detailView(database: LariatDatabase) -> some View {
    switch selection {
    case .cook(.today):
      TodayView(database: database)
    case .cook(.eightySix), .cook(.stations), .cook(.kds):
      TileDegrade(title: "Coming soon", message: "This cook screen ships in a later phase.", systemImage: "clock")
    case .manager(.command):
      CommandView(database: database, writeDatabase: sharedWriteDatabase)
    case .manager(.analytics):
      AnalyticsView(database: database)
    case .manager(.costing):
      CostingView(database: database)
    case .manager(.management):
      ManagementRollupView(database: database, writeDatabase: sharedWriteDatabase)
    }
  }
}
