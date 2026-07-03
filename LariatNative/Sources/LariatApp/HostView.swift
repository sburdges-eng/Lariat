import SwiftUI
import LariatDB

struct HostView: View {
  let database: LariatDatabase
  var body: some View {
    TileDegrade(title: "Host", message: "Coming soon to native.", systemImage: "person.2")
      .navigationTitle("Host")
  }
}
