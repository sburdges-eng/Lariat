import SwiftUI
import LariatDB

struct PrepView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Prep", message: "Coming soon to native.", systemImage: "clipboard")
      .navigationTitle("Prep")
  }
}
