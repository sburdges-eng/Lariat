// BeoPullComputeTests — drives the 10 beo_pull golden fixtures (build_demand /
// pull_orders / normalize_client) against the Swift port at Python parity.

import XCTest
@testable import LariatModel

final class BeoPullComputeTests: XCTestCase {

    private func accuracy(_ places: Int?) -> Double { pow(10.0, -Double(places ?? 6)) }

    // MARK: build_demand

    private func assertBuildDemand(
        _ id: String, file: StaticString = #filePath, line: UInt = #line
    ) throws {
        let f = try BeoFixtures.load(id)
        let (demand, unmapped) = BeoPullCompute.buildDemand(
            BeoFixtures.invoiceRows(f),
            manifest: BeoFixtures.manifest(f),
            beoMap: BeoFixtures.beoMap(f),
            qtyInYieldUnits: f.input.qtyInYieldUnits ?? false,
            scales: BeoFixtures.scalesDict(f)
        )
        let acc = accuracy(f.expect.tolerancePlaces)

        if let expected = f.expect.demand {
            XCTAssertEqual(demand.count, expected.count, "\(id): demand count", file: file, line: line)
            for (i, e) in expected.enumerated() where i < demand.count {
                XCTAssertEqual(demand[i].0, e.slug, "\(id): demand[\(i)] slug", file: file, line: line)
                XCTAssertEqual(demand[i].2, e.unit, "\(id): demand[\(i)] unit", file: file, line: line)
                XCTAssertEqual(demand[i].1, e.qty, accuracy: acc, "\(id): demand[\(i)] qty", file: file, line: line)
            }
        }
        if let expected = f.expect.unmapped {
            XCTAssertEqual(unmapped.count, expected.count, "\(id): unmapped count", file: file, line: line)
            for (i, e) in expected.enumerated() where i < unmapped.count {
                XCTAssertEqual(unmapped[i].menuItem, e.menuItem, "\(id): unmapped[\(i)] item", file: file, line: line)
                if !e.reason.isEmpty {
                    XCTAssertEqual(unmapped[i].reason, e.reason, "\(id): unmapped[\(i)] reason", file: file, line: line)
                }
            }
        }
        if let bySlug = f.expect.demandBySlug {
            var actual: [String: Double] = [:]
            for t in demand { actual[t.0, default: 0.0] += t.1 }
            XCTAssertEqual(actual.count, bySlug.count, "\(id): demand_by_slug count", file: file, line: line)
            for (slug, qty) in bySlug {
                guard let got = actual[slug] else {
                    XCTFail("\(id): demand_by_slug missing \(slug)", file: file, line: line); continue
                }
                XCTAssertEqual(got, qty, accuracy: acc, "\(id): demand_by_slug[\(slug)]", file: file, line: line)
            }
        }
        if let slugs = f.expect.demandSlugs {
            XCTAssertEqual(demand.map(\.0), slugs, "\(id): demand_slugs", file: file, line: line)
        }
        if let count = f.expect.unmappedCount {
            XCTAssertEqual(unmapped.count, count, "\(id): unmapped_count", file: file, line: line)
        }
    }

    func testBuildDemandOneBatch() throws { try assertBuildDemand("build_demand_one_batch") }
    func testBuildDemandYieldUnits() throws { try assertBuildDemand("build_demand_yield_units") }
    func testBuildDemandPerMappingScale() throws { try assertBuildDemand("build_demand_per_mapping_scale") }
    func testBuildDemandPartialScaleFactor() throws { try assertBuildDemand("build_demand_partial_scale_factor") }
    func testBuildDemandTrioMultiRecipe() throws { try assertBuildDemand("build_demand_trio_multi_recipe") }
    func testBuildDemandUnmapped() throws { try assertBuildDemand("build_demand_unmapped") }
    func testBuildDemandDirectNameResolution() throws { try assertBuildDemand("build_demand_direct_name_resolution") }

    // MARK: normalize_client

    func testNormalizeClientEquivalence() throws {
        let f = try BeoFixtures.load("normalize_client_equivalence")
        let samples = f.input.samples ?? []
        let expected = f.expect.normalized ?? []
        XCTAssertEqual(samples.count, expected.count, "sample count")
        for (i, s) in samples.enumerated() where i < expected.count {
            XCTAssertEqual(BeoPullCompute.normalizeClient(s), expected[i], "normalize sample[\(i)]")
        }
    }

    // Python normalizes with str.casefold(), which folds ß→ss, Straße→strasse,
    // Greek final sigma, etc. — `.lowercased()` does NOT. Locks the full-fold port.
    func testNormalizeClientMatchesPythonCasefold() {
        XCTAssertEqual(BeoPullCompute.normalizeClient("ß"), "ss")
        XCTAssertEqual(BeoPullCompute.normalizeClient("Straße"), "strasse")
        XCTAssertEqual(BeoPullCompute.normalizeClient(" Jalapeño "), "jalapeño")
        XCTAssertEqual(BeoPullCompute.normalizeClient(nil), "")
    }

    // MARK: pull_orders

    private func assertPullOrders(
        _ id: String, file: StaticString = #filePath, line: UInt = #line
    ) throws {
        let f = try BeoFixtures.load(id)
        let (demand, _) = BeoPullCompute.buildDemand(
            BeoFixtures.invoiceRows(f),
            manifest: BeoFixtures.manifest(f),
            beoMap: BeoFixtures.beoMap(f)
        )
        var warnings: [String] = []
        let orderGuide = BeoPullCompute.pullOrders(
            BeoFixtures.manifest(f), demand: demand,
            inventory: BeoFixtures.inventoryDict(f), warnings: &warnings
        )
        XCTAssertTrue(warnings.isEmpty, "\(id): unexpected warnings \(warnings)", file: file, line: line)
        let expected = f.expect.orderGuide ?? []
        let acc = accuracy(f.expect.tolerancePlaces)
        XCTAssertEqual(orderGuide.count, expected.count, "\(id): order_guide count", file: file, line: line)
        for (i, e) in expected.enumerated() where i < orderGuide.count {
            XCTAssertEqual(orderGuide[i].ingredient, e.ingredient, "\(id): og[\(i)] ingredient", file: file, line: line)
            XCTAssertEqual(orderGuide[i].unit, e.unit, "\(id): og[\(i)] unit", file: file, line: line)
            XCTAssertEqual(orderGuide[i].totalNeeded, e.totalNeeded, accuracy: acc, "\(id): og[\(i)] total", file: file, line: line)
            XCTAssertEqual(orderGuide[i].onHand, e.onHand, accuracy: acc, "\(id): og[\(i)] onHand", file: file, line: line)
            XCTAssertEqual(orderGuide[i].toOrder, e.toOrder, accuracy: acc, "\(id): og[\(i)] toOrder", file: file, line: line)
        }
    }

    func testPullOrdersSalsaAggregated() throws { try assertPullOrders("pull_orders_salsa_aggregated") }
    func testPullOrdersInventorySubtract() throws { try assertPullOrders("pull_orders_inventory_subtract") }
}
