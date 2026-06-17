import SwiftUI

@main
struct LariatApp: App {
    @State private var selection: Section? = .management
    enum Section: String, Hashable, CaseIterable, Identifiable {
        case management = "Management"
        var id: String { rawValue }
    }
    var body: some Scene {
        WindowGroup {
            NavigationSplitView {
                List(Section.allCases, selection: $selection) { section in
                    Text(section.rawValue).tag(section)
                }
                .navigationTitle("Lariat")
            } detail: {
                switch selection {
                case .management: ManagementRollupView()
                case nil: Text("Select a section")
                }
            }
        }
    }
}
