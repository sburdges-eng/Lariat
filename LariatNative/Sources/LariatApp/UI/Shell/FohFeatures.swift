import SwiftUI

/// Front-of-house feature modules (A6.1 wave). Floor + reservations carry
/// cook-identity audited writes; the host stand carries PIN-gated writes;
/// booking is a pure read over the shows pipeline. Write boards degrade to
/// a lock tile when the write database is unavailable.
extension FeatureModule {
    static let fohFloor = FeatureModule(id: "foh.floor") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(FloorView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Floor unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let fohHost = FeatureModule(id: "foh.host") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(HostStandView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Host stand unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let fohReservations = FeatureModule(id: "foh.reservations") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(ReservationsBoardView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Reservations unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let fohBooking = FeatureModule(id: "foh.booking") { ctx in
        AnyView(BookingBoardView(database: ctx.database, navigate: ctx.navigate))
    }
}
