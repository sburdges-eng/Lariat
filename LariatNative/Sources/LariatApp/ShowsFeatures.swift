import SwiftUI

/// Shows-tier feature modules (A6.4 wave). Every shows surface is
/// PIN-gated on the web (`/shows` + `/api/shows` SENSITIVE_PREFIXES); each
/// view carries its own `ShowsGateModel` and degrades to the locked state
/// when a PIN is configured. Views tolerate a missing write database
/// (reads stay live; writes surface an error), so no TileDegrade wrapper is
/// needed here.
extension FeatureModule {
    static let showsTonight = FeatureModule(id: "shows.tonight") { ctx in
        AnyView(ShowsTonightView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    static let showsArchive = FeatureModule(id: "shows.archive") { ctx in
        AnyView(ShowsArchiveView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    /// `/playbook` — read-only show-marketing checklists; the "Event ops"
    /// strip navigates to the per-show boards via `ctx.navigate`.
    static let showsPlaybook = FeatureModule(id: "shows.playbook") { ctx in
        AnyView(ShowPlaybookView(
            database: ctx.database,
            writeDatabase: ctx.writeDatabase,
            navigate: ctx.navigate
        ))
    }

    static let showsBoxOffice = FeatureModule(id: "shows.boxOffice") { ctx in
        AnyView(ShowBoxOfficeView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    static let showsSettlement = FeatureModule(id: "shows.settlement") { ctx in
        AnyView(ShowSettlementView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    static let showsSound = FeatureModule(id: "shows.sound") { ctx in
        AnyView(ShowSoundView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    static let showsStage = FeatureModule(id: "shows.stage") { ctx in
        AnyView(ShowStageView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }
}
