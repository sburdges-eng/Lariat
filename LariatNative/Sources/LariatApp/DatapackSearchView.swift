import SwiftUI
import LariatDB

struct DatapackSearchView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "DatapackSearch", message: "Coming soon to native.", systemImage: "magnifyingglass")
      .navigationTitle("DatapackSearch")
  }
}
