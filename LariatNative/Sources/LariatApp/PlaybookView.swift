import SwiftUI
import LariatDB

struct PlaybookView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Playbook", message: "Coming soon to native.", systemImage: "book")
      .navigationTitle("Playbook")
  }
}
