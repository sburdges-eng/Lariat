import SwiftUI

/// BEO feature modules (A6.5 wave). The parties board carries PIN-gated
/// audited writes (manager-PIN session; degrades to a lock tile when the
/// write database is unavailable); the fire-schedule rollup and past-prep
/// reference are pure reads. The web client-share/sign path is a confirmed
/// edge blocker and is NOT registered here.
extension FeatureModule {
    static let beoBoard = FeatureModule(id: "beo.board") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(BeoBoardView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Parties unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let beoFireSchedule = FeatureModule(id: "beo.fireSchedule") { ctx in
        AnyView(BeoFireScheduleView(database: ctx.database))
    }

    static let beoPrepHistory = FeatureModule(id: "beo.prepHistory") { ctx in
        AnyView(BeoPrepHistoryView(database: ctx.database))
    }
}
