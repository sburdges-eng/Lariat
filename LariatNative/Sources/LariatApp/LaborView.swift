import SwiftUI
import LariatDB

struct LaborView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Labor", message: "Coming soon to native.", systemImage: "person.3")
      .navigationTitle("Labor")
  }
}
