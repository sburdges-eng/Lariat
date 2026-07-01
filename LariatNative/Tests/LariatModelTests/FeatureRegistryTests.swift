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

    func testHaccpPlanIsPresent() {
        let plan = FeatureCatalog.descriptor(id: "safety.haccpPlan")
        XCTAssertNotNil(plan, "safety.haccpPlan must be registered")
        XCTAssertEqual(plan?.tier, .safety)
        XCTAssertEqual(plan?.title, "HACCP plan")
        XCTAssertEqual(plan?.enabled, true)
    }
}
