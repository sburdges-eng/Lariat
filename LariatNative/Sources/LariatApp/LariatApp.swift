import SwiftUI

@main
struct LariatApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationSplitView {
                List { NavigationLink("Management", value: "management") }
                    .navigationTitle("Lariat")
            } detail: {
                ManagementRollupView()
            }
        }
    }
}
