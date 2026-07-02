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
}
