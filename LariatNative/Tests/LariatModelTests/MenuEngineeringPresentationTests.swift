import XCTest
@testable import LariatModel

// Presentation-layer helpers for the standalone Menu Engineering screen
// (app/menu-engineering/page.tsx). The quadrant classification itself lives in
// CostingCompute.computeMenuEngineering; these helpers only shape the already
// computed rows for display:
//
//   hazards()        → "Critical Margin Hazards" banner: plowhorses < 20% margin
//   sortedForTable() → table order: costed rows first (net sales desc),
//                      uncosted ('unknown') rows sink to the bottom
//
// Rows are built directly via the (internal, @testable) memberwise init so these
// tests stay independent of the compute stage.

final class MenuEngineeringPresentationTests: XCTestCase {

    private func row(
        _ name: String,
        quadrant: Quadrant,
        marginPct: Double?,
        netSales: Double
    ) -> MenuEngineeringRow {
        MenuEngineeringRow(
            itemName: name,
            qty: 0,
            netSales: netSales,
            avgPrice: 0,
            costPerUnit: marginPct == nil ? nil : 1.0,
            marginPct: marginPct,
            popularity: 0,
            quadrant: quadrant
        )
    }

    // MARK: hazards

    func testHazardsReturnsOnlyPlowhorsesBelowThreshold() {
        let rows = [
            row("BelowThreshold", quadrant: .plowhorse, marginPct: 15.0, netSales: 100),
            row("AtThreshold",    quadrant: .plowhorse, marginPct: 20.0, netSales: 100), // 20 is NOT < 20
            row("AboveThreshold", quadrant: .plowhorse, marginPct: 25.0, netSales: 100),
            row("StarLowMargin",  quadrant: .star,      marginPct: 5.0,  netSales: 100), // not a plowhorse
            row("PlowhorseNoData", quadrant: .plowhorse, marginPct: nil, netSales: 100), // no margin
        ]

        let hazards = MenuEngineeringPresentation.hazards(rows)

        XCTAssertEqual(hazards.map(\.itemName), ["BelowThreshold"])
    }

    func testHazardsEmptyWhenNoPlowhorses() {
        let rows = [
            row("A", quadrant: .star, marginPct: 10.0, netSales: 100),
            row("B", quadrant: .dog,  marginPct: 5.0,  netSales: 100),
        ]
        XCTAssertTrue(MenuEngineeringPresentation.hazards(rows).isEmpty)
    }

    // MARK: sortedForTable

    func testSortedForTableSinksUnknownAndSortsByNetSalesDesc() {
        let rows = [
            row("StarMid",     quadrant: .star,    marginPct: 40.0, netSales: 100),
            row("UnknownHigh", quadrant: .unknown, marginPct: nil,  netSales: 500), // biggest $ but uncosted
            row("DogHigh",     quadrant: .dog,     marginPct: 5.0,  netSales: 300),
        ]

        let sorted = MenuEngineeringPresentation.sortedForTable(rows)

        // Costed rows first, net sales desc (DogHigh 300 > StarMid 100),
        // uncosted 'unknown' row last despite its higher net sales.
        XCTAssertEqual(sorted.map(\.itemName), ["DogHigh", "StarMid", "UnknownHigh"])
    }

    func testSortedForTableIsStableForEmptyInput() {
        XCTAssertTrue(MenuEngineeringPresentation.sortedForTable([]).isEmpty)
    }
}
