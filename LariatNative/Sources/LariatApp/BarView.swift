import SwiftUI
import LariatDB

struct BarView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Bar", message: "Coming soon to native.", systemImage: "wineglass")
      .navigationTitle("Bar")
  }
}
