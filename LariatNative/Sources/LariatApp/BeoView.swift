import SwiftUI
import LariatDB

struct BeoView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "BEO", message: "Coming soon to native.", systemImage: "doc.plaintext")
      .navigationTitle("BEO")
  }
}
