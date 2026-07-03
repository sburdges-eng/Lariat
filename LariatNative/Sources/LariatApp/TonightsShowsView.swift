import SwiftUI
import LariatDB

struct TonightsShowsView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Tonight's Shows", message: "Coming soon to native.", systemImage: "ticket")
      .navigationTitle("Tonight's Shows")
  }
}
