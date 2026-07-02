import XCTest
@testable import LariatModel

/// Guards the feature self-registration metadata (`FeatureCatalog`), which is the
/// single source of truth the app's `FeatureRegistry` binds views to.
final class FeatureRegistryTests: XCTestCase {
    func testIdsAreUnique() {
        let ids = FeatureCatalog.all.map(\.id)
        XCTAssertEqual(ids.count, Set(ids).count, "Feature ids must be unique")
    }

    func testEveryTierHasAtLeastOneModule() {
        for tier in FeatureTier.allCases {
            XCTAssertFalse(
                FeatureCatalog.descriptors(for: tier).isEmpty,
                "Tier \(tier.rawValue) must have at least one feature"
            )
        }
    }

    func testDefaultIdResolves() {
        XCTAssertEqual(FeatureCatalog.defaultId, "cook.today")
        XCTAssertNotNil(
            FeatureCatalog.descriptor(id: FeatureCatalog.defaultId),
            "Default feature id must resolve to a descriptor"
        )
    }

    func testCoolingIsPresent() {
        let cooling = FeatureCatalog.descriptor(id: "safety.cooling")
        XCTAssertNotNil(cooling, "safety.cooling must be registered")
        XCTAssertEqual(cooling?.tier, .safety)
        XCTAssertEqual(cooling?.title, "Cooling")
    }

    func testSickWorkerIsPresent() {
        let sick = FeatureCatalog.descriptor(id: "safety.sickWorker")
        XCTAssertNotNil(sick, "safety.sickWorker must be registered")
        XCTAssertEqual(sick?.tier, .safety)
        XCTAssertEqual(sick?.title, "Sick worker")
    }

    func testHaccpPlanIsPresent() {
        let plan = FeatureCatalog.descriptor(id: "safety.haccpPlan")
        XCTAssertNotNil(plan, "safety.haccpPlan must be registered")
        XCTAssertEqual(plan?.tier, .safety)
        XCTAssertEqual(plan?.title, "HACCP plan")
        XCTAssertEqual(plan?.enabled, true)
    }

    func testShowsTierRegistered() {
        // A6.4: the shows wave adds its own tier with exactly six boards,
        // in sidebar order tonight → box office → settlement → sound →
        // stage → archive.
        XCTAssertTrue(FeatureTier.allCases.contains(.shows))
        XCTAssertEqual(
            FeatureCatalog.descriptors(for: .shows).map(\.id),
            [
                "shows.tonight", "shows.boxOffice", "shows.settlement",
                "shows.sound", "shows.stage", "shows.archive",
            ]
        )
        let settlement = FeatureCatalog.descriptor(id: "shows.settlement")
        XCTAssertEqual(settlement?.tier, .shows)
        XCTAssertEqual(settlement?.title, "Settlement")
        XCTAssertEqual(settlement?.enabled, true)
    }

    func testA1WaveBoardsAllRegistered() {
        for id in [
            "safety.sanitizer", "safety.tphc", "safety.pest", "safety.sds",
            "safety.sickWorker", "safety.receiving", "safety.haccpPlan",
        ] {
            let d = FeatureCatalog.descriptor(id: id)
            XCTAssertNotNil(d, "\(id) must be registered")
            XCTAssertEqual(d?.tier, .safety, "\(id) must be a safety feature")
        }
    }

    func testMorningIsPresent() {
        let morning = FeatureCatalog.descriptor(id: "cook.morning")
        XCTAssertNotNil(morning, "cook.morning must be registered")
        XCTAssertEqual(morning?.tier, .cook)
        XCTAssertEqual(morning?.title, "Morning")
        XCTAssertEqual(morning?.enabled, true)
    }

    func testA2CookPortsAllRegistered() {
        for id in ["cook.prep", "cook.prepPar", "cook.morning"] {
            let d = FeatureCatalog.descriptor(id: id)
            XCTAssertNotNil(d, "\(id) must be registered")
            XCTAssertEqual(d?.tier, .cook, "\(id) must be a cook feature")
        }
    }

    /// A3 Labor wave (L0 + L1): the `.labor` tier exists and the certs board is
    /// registered under it. As the remaining boards (L2–L4) land they append here.
    func testLaborTierBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.labor), "the .labor tier must exist")
        let certs = FeatureCatalog.descriptor(id: "labor.certs")
        XCTAssertNotNil(certs, "labor.certs must be registered")
        XCTAssertEqual(certs?.tier, .labor)
        XCTAssertEqual(certs?.title, "Certifications")
        XCTAssertEqual(certs?.enabled, true)
        // L2: sick-leave board registered under the same tier.
        let sick = FeatureCatalog.descriptor(id: "labor.sickLeave")
        XCTAssertNotNil(sick, "labor.sickLeave must be registered")
        XCTAssertEqual(sick?.tier, .labor)
        XCTAssertEqual(sick?.title, "Sick time")
        // L3: tip-pool board registered under the same tier.
        let tips = FeatureCatalog.descriptor(id: "labor.tipPool")
        XCTAssertNotNil(tips, "labor.tipPool must be registered")
        XCTAssertEqual(tips?.tier, .labor)
        XCTAssertEqual(tips?.title, "Tip pool")
        // L4: wage-notices board registered under the same tier.
        let wage = FeatureCatalog.descriptor(id: "labor.wageNotices")
        XCTAssertNotNil(wage, "labor.wageNotices must be registered")
        XCTAssertEqual(wage?.tier, .labor)
        XCTAssertEqual(wage?.title, "Wage notices")
        // The tier must not be empty (guards testEveryTierHasAtLeastOneModule).
        XCTAssertFalse(FeatureCatalog.descriptors(for: .labor).isEmpty)
    }

    func testInventoryTierBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.inventory), "the .inventory tier must exist")
        let par = FeatureCatalog.descriptor(id: "inventory.par")
        XCTAssertNotNil(par, "inventory.par must be registered")
        XCTAssertEqual(par?.tier, .inventory)
        XCTAssertEqual(par?.title, "Par")
        // Counts / Log / Waste boards registered under the same tier.
        for (id, title) in [("inventory.counts", "Counts"), ("inventory.log", "Log"), ("inventory.waste", "Waste")] {
            let d = FeatureCatalog.descriptor(id: id)
            XCTAssertNotNil(d, "\(id) must be registered")
            XCTAssertEqual(d?.tier, .inventory, "\(id) must be an inventory feature")
            XCTAssertEqual(d?.title, title)
            XCTAssertEqual(d?.enabled, true)
        }
        XCTAssertFalse(FeatureCatalog.descriptors(for: .inventory).isEmpty)
    }

    /// A4.2 Board 1: `.costing` tier relocation — `manager.costing` moves to
    /// `costing.overview` under a new `.costing` tier.
    func testCostingTierRelocation() {
        XCTAssertTrue(FeatureTier.allCases.contains(.costing), "the .costing tier must exist")
        XCTAssertEqual(FeatureTier.costing.rawValue, "Costing")
        // Old manager.costing id is gone; overview relocated under .costing.
        XCTAssertNil(
            FeatureCatalog.descriptor(id: "manager.costing"),
            "manager.costing must be relocated to costing.overview"
        )
        let overview = FeatureCatalog.descriptor(id: "costing.overview")
        XCTAssertNotNil(overview, "costing.overview must be registered")
        XCTAssertEqual(overview?.tier, .costing)
        XCTAssertEqual(overview?.title, "Costing")
        XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)
    }

    /// A4.2 Board 1: the priceShocks board registers under `.costing`;
    /// `costing.prices` is a drill-down (selection state), NOT a sidebar tile.
    func testCostingPriceShocksRegistered() {
        let d = FeatureCatalog.descriptor(id: "costing.priceShocks")
        XCTAssertNotNil(d, "costing.priceShocks must be registered")
        XCTAssertEqual(d?.tier, .costing)
        XCTAssertEqual(d?.title, "Price shocks")
        XCTAssertEqual(d?.enabled, true)
        // costing.prices is a drill-down, NOT a catalog descriptor:
        XCTAssertNil(
            FeatureCatalog.descriptor(id: "costing.prices"),
            "price history is reached from a shock row, not a sidebar tile"
        )
    }

    /// A4.2 Board 2: variance-attribution board registers under `.costing`, the same
    /// tier Board 1 created. Pure read — no PIN sheet (matches the web route, which
    /// has no in-route PIN either, only /costing middleware gating).
    func testCostingVarianceAttributionRegistered() {
        let d = FeatureCatalog.descriptor(id: "costing.varianceAttribution")
        XCTAssertNotNil(d, "costing.varianceAttribution must be registered")
        XCTAssertEqual(d?.tier, .costing)
        XCTAssertEqual(d?.title, "Variance attribution")
        XCTAssertEqual(d?.enabled, true)
        XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)
    }

    /// A4.2 Board 3: depletion-exceptions board registers under `.costing`.
    /// Pure read — the web route IS PIN-gated (requirePin in route.js), but
    /// native manager/costing-tier reads are not per-view PIN-gated today
    /// (matches the priceShocks/varianceAttribution precedent).
    func testCostingTierBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.costing), "the .costing tier must exist")
        // A0 relocation: the old manager.costing aggregate now lives at costing.overview.
        let overview = FeatureCatalog.descriptor(id: "costing.overview")
        XCTAssertNotNil(overview, "costing.overview must be registered")
        XCTAssertEqual(overview?.tier, .costing)
        // This board:
        let de = FeatureCatalog.descriptor(id: "costing.depletionExceptions")
        XCTAssertNotNil(de, "costing.depletionExceptions must be registered")
        XCTAssertEqual(de?.tier, .costing)
        XCTAssertEqual(de?.title, "Depletion exceptions")
        XCTAssertEqual(de?.enabled, true)
        XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)
    }

    /// A4.2 Board 4 (LAST board): ingredient-masters registers under `.costing`.
    /// This is the wave's ONE audited write (the other three costing boards are
    /// pure reads). The `.costing` tier + relocation are already covered by
    /// `testCostingTierRelocation` — this test only guards this board's own
    /// descriptor + that the tier stays non-empty.
    func testCostingIngredientMastersRegistered() {
        let d = FeatureCatalog.descriptor(id: "costing.ingredientMasters")
        XCTAssertNotNil(d, "costing.ingredientMasters must be registered")
        XCTAssertEqual(d?.tier, .costing)
        XCTAssertEqual(d?.title, "Ingredient masters")
        XCTAssertEqual(d?.enabled, true)
        XCTAssertFalse(FeatureCatalog.descriptors(for: .costing).isEmpty)
    }

    /// A4.3 Board (T2): margin-deltas registers under `.costing`. Pure read —
    /// no PIN sheet (the web route sits behind /menu-engineering middleware
    /// only, matching the priceShocks precedent).
    func testCostingMarginDeltasRegistered() {
        let d = FeatureCatalog.descriptor(id: "costing.marginDeltas")
        XCTAssertNotNil(d, "costing.marginDeltas must be registered")
        XCTAssertEqual(d?.tier, .costing)
        XCTAssertEqual(d?.title, "Margin moves")
        XCTAssertEqual(d?.enabled, true)
    }

    /// A4.3 Board (T3): the menu-engineering hub registers under `.costing`.
    /// Pure read (the writes live on costing.components).
    func testCostingMenuEngineeringRegistered() {
        let d = FeatureCatalog.descriptor(id: "costing.menuEngineering")
        XCTAssertNotNil(d, "costing.menuEngineering must be registered")
        XCTAssertEqual(d?.tier, .costing)
        XCTAssertEqual(d?.title, "Menu performance")
        XCTAssertEqual(d?.enabled, true)
    }

    /// A4.3 Board (T4): the dish-components editor registers under `.costing`.
    /// This is the wave's write surface — writes are transactional but post NO
    /// audit_events (web-route parity; see DishComponentsRepositoryTests).
    func testCostingComponentsRegistered() {
        let d = FeatureCatalog.descriptor(id: "costing.components")
        XCTAssertNotNil(d, "costing.components must be registered")
        XCTAssertEqual(d?.tier, .costing)
        XCTAssertEqual(d?.title, "Dish components")
        XCTAssertEqual(d?.enabled, true)
    }

    /// A4.2 consolidation, extended by the A4.3 menu-engineering wave: the
    /// `.costing` tier holds EXACTLY the listed boards, all enabled; the old
    /// `manager.costing` is gone and `costing.prices` is a drill-down (never a
    /// tile); Manager stays non-empty after the relocation. (The FeatureModule/
    /// FeatureRegistry binding lives in the app target, out of reach of
    /// LariatModelTests; `FeatureModule.init`'s precondition guards it at
    /// app-build/render time.)
    func testCostingTierIsComplete() {
        let ids = Set(FeatureCatalog.descriptors(for: .costing).map(\.id))
        XCTAssertEqual(ids, [
            "costing.overview", "costing.priceShocks", "costing.varianceAttribution",
            "costing.depletionExceptions", "costing.ingredientMasters",
            "costing.menuEngineering", "costing.marginDeltas", "costing.components",
        ], "the .costing tier must hold exactly the registered detail boards")
        for id in ids {
            XCTAssertEqual(FeatureCatalog.descriptor(id: id)?.tier, .costing, "\(id) must be a costing feature")
            XCTAssertEqual(FeatureCatalog.descriptor(id: id)?.enabled, true, "\(id) must be enabled")
        }
        XCTAssertNil(FeatureCatalog.descriptor(id: "manager.costing"), "manager.costing must be relocated")
        XCTAssertNil(FeatureCatalog.descriptor(id: "costing.prices"), "price history is a drill-down, not a tile")
        XCTAssertFalse(FeatureCatalog.descriptors(for: .manager).isEmpty, "Manager tier must stay non-empty after the relocation")
    }

    /// A5 management-writes wave: the four manager boards register under the
    /// EXISTING `.manager` tier (no new tier). auditLog is read-only; pins /
    /// tempPins / receivingMatches carry PIN-gated audited writes.
    func testA5ManagementBoardsRegistered() {
        for (id, title) in [
            ("manager.auditLog", "Audit log"),
            ("manager.pins", "PINs"),
            ("manager.tempPins", "Temp PINs"),
            ("manager.receivingMatches", "Receiving matches"),
        ] {
            let d = FeatureCatalog.descriptor(id: id)
            XCTAssertNotNil(d, "\(id) must be registered")
            XCTAssertEqual(d?.tier, .manager, "\(id) must be a manager feature")
            XCTAssertEqual(d?.title, title)
            XCTAssertEqual(d?.enabled, true, "\(id) must be enabled")
        }
        // The manager tier holds exactly the three pre-A5 boards + the four
        // A5 boards after this wave.
        let ids = Set(FeatureCatalog.descriptors(for: .manager).map(\.id))
        XCTAssertEqual(ids, [
            "manager.command", "manager.analytics", "manager.management",
            "manager.auditLog", "manager.pins", "manager.tempPins",
            "manager.receivingMatches",
        ])
    }

    /// A4.4 Purchasing wave: the `.purchasing` tier exists and holds EXACTLY
    /// the three boards — the read-only order-guide hub plus the compare and
    /// link boards (both carrying PIN-gated audited writes) — all enabled.
    func testPurchasingTierBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.purchasing), "the .purchasing tier must exist")
        XCTAssertEqual(FeatureTier.purchasing.rawValue, "Purchasing")
        for (id, title) in [
            ("purchasing.orderGuide", "Order guide"),
            ("purchasing.compare", "Vendor compare"),
            ("purchasing.link", "Link vendors"),
        ] {
            let d = FeatureCatalog.descriptor(id: id)
            XCTAssertNotNil(d, "\(id) must be registered")
            XCTAssertEqual(d?.tier, .purchasing, "\(id) must be a purchasing feature")
            XCTAssertEqual(d?.title, title)
            XCTAssertEqual(d?.enabled, true, "\(id) must be enabled")
        }
        let ids = Set(FeatureCatalog.descriptors(for: .purchasing).map(\.id))
        XCTAssertEqual(
            ids,
            ["purchasing.orderGuide", "purchasing.compare", "purchasing.link"],
            "the .purchasing tier must hold exactly the three A4.4 boards"
        )
    }

    /// A6.2 House wave: the `.house` tier exists and holds EXACTLY the four
    /// venue-program boards — bar program + bar par (read-only), equipment
    /// (open non-audited writes, web parity) and gold stars (PIN-gated
    /// audited writes) — all enabled.
    func testA62HouseBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.house), "the .house tier must exist")
        XCTAssertEqual(FeatureTier.house.rawValue, "House")
        for (id, title) in [
            ("house.bar", "Bar program"),
            ("house.barPar", "Bar par"),
            ("house.equipment", "Equipment"),
            ("house.goldStars", "Gold stars"),
        ] {
            let d = FeatureCatalog.descriptor(id: id)
            XCTAssertNotNil(d, "\(id) must be registered")
            XCTAssertEqual(d?.tier, .house, "\(id) must be a house feature")
            XCTAssertEqual(d?.title, title)
            XCTAssertEqual(d?.enabled, true, "\(id) must be enabled")
        }
        let ids = Set(FeatureCatalog.descriptors(for: .house).map(\.id))
        XCTAssertEqual(
            ids,
            ["house.bar", "house.barPar", "house.equipment", "house.goldStars"],
            "the .house tier must hold exactly the four A6.2 boards"
        )
    }

    /// A6.1 FOH wave: the `.foh` tier exists and holds EXACTLY the four
    /// boards — floor + reservations (cook-identity audited writes), the
    /// host stand (PIN-gated writes, reads open), and the read-only booking
    /// calendar — all enabled. /host + /booking are middleware-PIN-gated on
    /// web; the native surfaces enforce their own write gates, so the
    /// descriptors stay enabled (cook.morning precedent).
    func testFohTierBoardsRegistered() {
        XCTAssertTrue(FeatureTier.allCases.contains(.foh), "the .foh tier must exist")
        XCTAssertEqual(FeatureTier.foh.rawValue, "Front of house")
        for (id, title) in [
            ("foh.floor", "Floor"),
            ("foh.host", "Host stand"),
            ("foh.reservations", "Reservations"),
            ("foh.booking", "Booking"),
        ] {
            let d = FeatureCatalog.descriptor(id: id)
            XCTAssertNotNil(d, "\(id) must be registered")
            XCTAssertEqual(d?.tier, .foh, "\(id) must be a foh feature")
            XCTAssertEqual(d?.title, title)
            XCTAssertEqual(d?.enabled, true, "\(id) must be enabled")
        }
        let ids = Set(FeatureCatalog.descriptors(for: .foh).map(\.id))
        XCTAssertEqual(
            ids,
            ["foh.floor", "foh.host", "foh.reservations", "foh.booking"],
            "the .foh tier must hold exactly the four A6.1 boards"
        )
    }
}
