import SwiftUI
import LariatDB

struct MorningView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Morning", message: "Coming soon to native.", systemImage: "sun.max")
      .navigationTitle("Morning")
  }
}
