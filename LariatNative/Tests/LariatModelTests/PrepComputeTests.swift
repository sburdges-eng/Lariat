import XCTest
@testable import LariatModel

// Value-parity port of tests/js/test-prep-median.mjs (lib/beoPrepHistory
// getPrepMedianForItems + parseAmountQty) plus the board-grouping rules from
// app/prep/PrepBoard.jsx (station ordering, closed bin, status counts,
// low-par suggestion filtering) and the cleanPriority clamp.

final class PrepComputeTests: XCTestCase {

    // MARK: - parseAmountQty (mirrors lib/beoPrepHistory.parseAmountQty)

    func testParsesBareIntegersAndDecimals() {
        XCTAssertEqual(PrepCompute.parseAmountQty("50"), 50)
        XCTAssertEqual(PrepCompute.parseAmountQty("40.5"), 40.5)
    }

    func testParsesLeadingNumberWithTrailingUnitToken() {
        XCTAssertEqual(PrepCompute.parseAmountQty("30 ea"), 30)
        XCTAssertEqual(PrepCompute.parseAmountQty("50 lb"), 50)
    }

    func testParsesThousandsSeparatorCommas() {
        XCTAssertEqual(PrepCompute.parseAmountQty("1,000"), 1000)
        XCTAssertEqual(PrepCompute.parseAmountQty("2,500 ea"), 2500)
    }

    func testDescriptiveAndEmptyValuesAreNonNumeric() {
        XCTAssertNil(PrepCompute.parseAmountQty("as needed"))
        XCTAssertNil(PrepCompute.parseAmountQty("TBD"))
        XCTAssertNil(PrepCompute.parseAmountQty(nil))
        XCTAssertNil(PrepCompute.parseAmountQty(""))
        XCTAssertNil(PrepCompute.parseAmountQty("   "))
    }

    func testZeroAndNegativeTreatedAsNonNumeric() {
        XCTAssertNil(PrepCompute.parseAmountQty("0"))
        XCTAssertNil(PrepCompute.parseAmountQty("-5"))
        XCTAssertEqual(PrepCompute.parseAmountQty("10"), 10)
    }

    // MARK: - getPrepMedianForItems — empty / dedupe / omission

    func testReturnsEmptyMapWhenItemsEmpty() {
        let m = PrepCompute.medianForItems(rowsByKey: ["mac balls": ["50"]], items: [])
        XCTAssertEqual(m.count, 0)
    }

    func testSkipsWhitespaceItemsAndDedupesByLowercase() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["mac balls": ["50"]],
            items: ["Mac Balls", "mac balls", "", "   "]
        )
        XCTAssertEqual(m.count, 1)
        XCTAssertNotNil(m["mac balls"])
    }

    func testOmitsItemsWithNoRows() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["mac balls": ["50"]],
            items: ["Carnitas", "Mac Balls"]
        )
        XCTAssertEqual(m.count, 1)
        XCTAssertNotNil(m["mac balls"])
    }

    func testKeysMapByTrimLowercase() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["mac balls": ["50"]],
            items: ["  Mac Balls  "]
        )
        XCTAssertEqual(m.count, 1)
        XCTAssertNotNil(m["mac balls"])
        XCTAssertNil(m[" mac balls "])
        XCTAssertNil(m["  Mac Balls  "])
    }

    // MARK: - getPrepMedianForItems — numeric coercion

    func testMedianOfThreeParsedValues() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["mac balls": ["50", "40.5", "60"]],
            items: ["Mac Balls"]
        )
        let row = m["mac balls"]
        XCTAssertEqual(row?.samples, 3)
        XCTAssertEqual(row?.median, 50)  // sorted: 40.5, 50, 60 → middle = 50
    }

    func testMedianOfTwoUnitTokenValues() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["mac balls": ["30 ea", "50 lb"]],
            items: ["Mac Balls"]
        )
        XCTAssertEqual(m["mac balls"]?.median, 40)  // (30+50)/2
    }

    func testExcludesDescriptiveValuesFromMedianButCountsTotalRows() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["mac balls": ["as needed", "TBD", nil, "50", "60"]],
            items: ["Mac Balls"]
        )
        let row = m["mac balls"]
        XCTAssertEqual(row?.samples, 2)      // only "50" + "60" parse
        XCTAssertEqual(row?.totalRows, 5)    // but all 5 matched
        XCTAssertEqual(row?.median, 55)
    }

    func testOmitsItemsWhereEveryValueNonNumeric() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["sauce": ["as needed", "TBD"]],
            items: ["Sauce"]
        )
        XCTAssertEqual(m.count, 0)
    }

    // MARK: - getPrepMedianForItems — median math

    func testOddCountPicksMiddle() {
        let m = PrepCompute.medianForItems(rowsByKey: ["a": ["1", "7", "3"]], items: ["A"])
        XCTAssertEqual(m["a"]?.median, 3)
    }

    func testEvenCountAveragesMiddlePair() {
        let m = PrepCompute.medianForItems(rowsByKey: ["a": ["10", "20", "30", "40"]], items: ["A"])
        XCTAssertEqual(m["a"]?.median, 25)  // (20+30)/2
    }

    func testSingleSampleReturnsThatValue() {
        let m = PrepCompute.medianForItems(rowsByKey: ["a": ["99"]], items: ["A"])
        XCTAssertEqual(m["a"]?.median, 99)
    }

    func testBatchOfManyItems() {
        let m = PrepCompute.medianForItems(
            rowsByKey: ["a": ["10", "20"], "b": ["5"], "c": ["as needed"]],
            items: ["A", "B", "C", "D"]
        )
        XCTAssertEqual(m.count, 2)  // C all-non-numeric, D has no rows
        XCTAssertEqual(m["a"]?.median, 15)
        XCTAssertEqual(m["b"]?.median, 5)
        XCTAssertNil(m["c"])
        XCTAssertNil(m["d"])
    }

    // MARK: - cleanPriority (mirrors the route clamp)

    func testPriorityClamp() {
        XCTAssertEqual(PrepPriority.clamp(-3), .normal)
        XCTAssertEqual(PrepPriority.clamp(0), .normal)
        XCTAssertEqual(PrepPriority.clamp(1), .high)
        XCTAssertEqual(PrepPriority.clamp(2), .rush)
        XCTAssertEqual(PrepPriority.clamp(9), .rush)
    }

    // MARK: - board grouping (mirrors PrepBoard.jsx grouped/counts)

    private func row(
        id: Int64, task: String, station: String?, status: String,
        priority: Int = 0, sortOrder: Int = 0, source: String? = "manual",
        sourceRef: String? = nil, assigned: String? = nil
    ) -> PrepTaskRow {
        PrepTaskRow(
            id: id, shiftDate: "2099-05-28", stationId: station, task: task, qty: nil,
            recipeSlug: nil, notes: nil, priority: priority, assignedCookId: assigned,
            status: status, startedAt: nil, doneAt: nil, doneBy: nil, source: source,
            sourceRef: sourceRef, sortOrder: sortOrder, locationId: "default",
            createdAt: nil, updatedAt: nil
        )
    }

    private let stations = [
        KitchenStation(id: "grill", name: "Grill", line: nil, lineCheckKey: nil),
        KitchenStation(id: "prep", name: "Prep", line: nil, lineCheckKey: nil),
    ]

    func testGroupsOpenByStationInCatalogOrderAnyLast() {
        let tasks = [
            row(id: 1, task: "unassigned", station: nil, status: "todo"),
            row(id: 2, task: "at prep", station: "prep", status: "todo"),
            row(id: 3, task: "at grill", station: "grill", status: "in_progress"),
        ]
        let groups = PrepCompute.groupOpen(tasks, stations: stations)
        XCTAssertEqual(groups.map(\.stationId), ["grill", "prep", ""])
        XCTAssertEqual(groups.last?.stationName, "Any station")
    }

    func testUnknownStationSortsAfterKnownButBeforeAny() {
        let tasks = [
            row(id: 1, task: "any", station: nil, status: "todo"),
            row(id: 2, task: "ghost", station: "ghost-station", status: "todo"),
            row(id: 3, task: "grill", station: "grill", status: "todo"),
        ]
        let groups = PrepCompute.groupOpen(tasks, stations: stations)
        XCTAssertEqual(groups.map(\.stationId), ["grill", "ghost-station", ""])
    }

    func testClosedTasksExcludedFromOpenGroups() {
        let tasks = [
            row(id: 1, task: "open", station: "prep", status: "todo"),
            row(id: 2, task: "done", station: "prep", status: "done"),
            row(id: 3, task: "skipped", station: "prep", status: "skipped"),
        ]
        let groups = PrepCompute.groupOpen(tasks, stations: stations)
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups.first?.tasks.map(\.id), [1])
        let closed = PrepCompute.closedBin(tasks)
        XCTAssertEqual(Set(closed.map(\.id)), [2, 3])
    }

    func testStatusCounts() {
        let tasks = [
            row(id: 1, task: "a", station: nil, status: "todo"),
            row(id: 2, task: "b", station: nil, status: "todo"),
            row(id: 3, task: "c", station: nil, status: "in_progress"),
            row(id: 4, task: "d", station: nil, status: "done"),
            row(id: 5, task: "e", station: nil, status: "skipped"),
        ]
        let c = PrepCompute.counts(tasks)
        XCTAssertEqual(c, PrepStatusCounts(todo: 2, inProgress: 1, done: 1, skipped: 1))
    }

    // MARK: - suggestion filtering (mirrors page.jsx openTaskIngredients)

    func testSuggestionsFilterOutIngredientsWithOpenLowParTask() {
        let tasks = [
            // open low_par task for "aji" → aji should be suppressed
            row(id: 1, task: "Prep aji", station: nil, status: "todo",
                source: "low_par", sourceRef: "aji"),
            // done low_par task for "salsa" → salsa NOT suppressed (only open counts)
            row(id: 2, task: "Prep salsa", station: nil, status: "done",
                source: "low_par", sourceRef: "salsa"),
        ]
        let suppressed = PrepCompute.openLowParIngredients(tasks)
        XCTAssertTrue(suppressed.contains("aji"))
        XCTAssertFalse(suppressed.contains("salsa"))
    }
}
