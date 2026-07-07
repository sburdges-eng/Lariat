import XCTest
@testable import LariatModel

// The BEO sheet print computation is a native-only nicety — `BeoBoard.tsx`
// has no print/export view, so unlike `SettlementPrintComputeTests` there is
// no web parity oracle to port. These cases pin the native contract
// directly: event header fields, per-line-item field coverage + alignment,
// a courses/fire-time section, an empty-lines state, and — critically — that
// the money footer renders EXACTLY the passed-in `Totals` rather than
// recomputing from `lines` (the cascade-exclusion / single-source-of-truth
// contract for this renderer).
final class BeoPrintComputeTests: XCTestCase {

    private func event(
        title: String = "Bob Clauss Rehearsal Dinner",
        eventDate: String? = "2026-08-14",
        eventTime: String? = "5-7pm",
        contactName: String? = "Bob Clauss",
        guestCount: Int? = 40
    ) -> BeoEventRow {
        BeoEventRow(
            id: 1, title: title, eventDate: eventDate, eventTime: eventTime,
            contactName: contactName, guestCount: guestCount, notes: nil, status: nil,
            taxRate: 0.0675, serviceFeePct: 20, minSpend: nil,
            locationId: "default", createdAt: nil
        )
    }

    private func line(
        id: Int64 = 1,
        itemName: String = "Nashville Slider",
        category: String? = "Apps",
        unitCost: Double = 6.0,
        quantity: Double = 50,
        prepNotes: String? = "Pico de Gallo, mexi slaw",
        courseId: Int64? = nil
    ) -> BeoLineItemRow {
        BeoLineItemRow(
            id: id, eventId: 1, sortOrder: 0, itemName: itemName, category: category,
            unitCost: unitCost, quantity: quantity, prepNotes: prepNotes,
            secondaryPrepNotes: nil, orderItemsNotes: nil, orderTime: nil,
            groupNote: nil, courseId: courseId
        )
    }

    private func course(
        id: Int64 = 1, courseLabel: String = "Entree", fireAt: String = "2026-08-14T18:30:00.000Z"
    ) -> BeoCourseRow {
        BeoCourseRow(
            id: id, eventId: 1, locationId: "default", courseLabel: courseLabel,
            fireAt: fireAt, notes: nil, sortOrder: 0, stationId: nil,
            createdAt: nil, updatedAt: nil
        )
    }

    /// Deliberately NOT derivable from `lines` — proves the renderer uses the
    /// passed-in totals rather than recomputing them.
    private let contrivedTotals = BeoWorksheetCompute.Totals(
        subtotal: 999.99, tax: 67.50, fee: 200.00, total: 1267.49
    )

    // ── event header ────────────────────────────────────────────────────

    func testEventHeaderContainsTitleDateTimeContactAndGuestCount() {
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [], courses: [], totals: contrivedTotals)
        XCTAssertTrue(text.contains("Bob Clauss Rehearsal Dinner"), "title")
        XCTAssertTrue(text.contains("2026-08-14"), "date")
        XCTAssertTrue(text.contains("5-7pm"), "time")
        XCTAssertTrue(text.contains("Bob Clauss"), "contact")
        XCTAssertTrue(text.contains("40"), "guest count")
    }

    func testEventHeaderHandlesNilFieldsGracefully() {
        let text = BeoPrintCompute.renderText(
            event: event(eventDate: nil, eventTime: nil, contactName: nil, guestCount: nil),
            lines: [], courses: [], totals: contrivedTotals)
        XCTAssertTrue(text.contains("Bob Clauss Rehearsal Dinner"))
        // Should not crash and should still produce a header section.
        XCTAssertFalse(text.isEmpty)
    }

    // ── line items ──────────────────────────────────────────────────────

    func testLineItemRowContainsItemCategoryQtyPrepNotesAndCourse() {
        let c = course()
        let l = line(courseId: c.id)
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [l], courses: [c], totals: contrivedTotals)
        XCTAssertTrue(text.contains("Nashville Slider"), "item name")
        XCTAssertTrue(text.contains("Apps"), "category")
        XCTAssertTrue(text.contains("50"), "qty")
        XCTAssertTrue(text.contains("Pico de Gallo, mexi slaw"), "prep notes")
        XCTAssertTrue(text.contains("Entree"), "course label")
    }

    func testLineItemWithNoCourseRendersEmDash() {
        let l = line(courseId: nil)
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [l], courses: [], totals: contrivedTotals)
        XCTAssertTrue(text.contains("—"))
    }

    func testLineItemRowsAreAlignedOneLinePerItem() {
        let l1 = line(id: 1, itemName: "Nashville Slider", category: "Apps", quantity: 50)
        let l2 = line(id: 2, itemName: "Brisket Taco", category: "Mains", quantity: 6)
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [l1, l2], courses: [], totals: contrivedTotals)
        let lines = text.components(separatedBy: "\n")
        guard let sliderLine = lines.first(where: { $0.contains("Nashville Slider") }),
              let tacoLine = lines.first(where: { $0.contains("Brisket Taco") }) else {
            return XCTFail("expected one line per row")
        }
        // Aligned columns: the category column starts at the same offset on
        // every row, regardless of item-name length.
        XCTAssertEqual(sliderLine.range(of: "Apps")?.lowerBound.utf16Offset(in: sliderLine),
                        tacoLine.range(of: "Mains")?.lowerBound.utf16Offset(in: tacoLine))
    }

    func testEmptyLineItemsShowsEmptyState() {
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [], courses: [], totals: contrivedTotals)
        XCTAssertTrue(text.lowercased().contains("no line items"))
    }

    // ── courses / fire-time section ─────────────────────────────────────

    func testCoursesSectionListsLabelAndFireTime() {
        let c = course(courseLabel: "Entree", fireAt: "2026-08-14T18:30:00.000Z")
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [], courses: [c], totals: contrivedTotals)
        XCTAssertTrue(text.contains("COURSES"))
        XCTAssertTrue(text.contains("Entree"))
        // Derive the expected local time the SAME way the renderer must —
        // avoids hardcoding a timezone-dependent clock string.
        XCTAssertTrue(text.contains(BeoCourseRules.isoToLocalHHMM(c.fireAt)))
    }

    func testEmptyCoursesShowsEmptyState() {
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [], courses: [], totals: contrivedTotals)
        XCTAssertTrue(text.lowercased().contains("no courses"))
    }

    // ── money footer: MUST use the passed-in totals, never recompute ────

    func testMoneyFooterRendersExactlyThePassedInTotals() {
        // `lines` here would total $300.00 (6.0 × 50) if the renderer
        // recomputed via BeoWorksheetCompute — but `contrivedTotals` is
        // deliberately different. Only the passed-in totals may appear.
        let l = line(unitCost: 6.0, quantity: 50)
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [l], courses: [], totals: contrivedTotals)
        XCTAssertTrue(text.contains("$999.99"), "subtotal from passed-in totals")
        XCTAssertTrue(text.contains("$67.50"), "tax from passed-in totals")
        XCTAssertTrue(text.contains("$200.00"), "fee from passed-in totals")
        XCTAssertTrue(text.contains("$1,267.49"), "total from passed-in totals")
        // The would-be recomputed line subtotal must NOT appear anywhere.
        XCTAssertFalse(text.contains("$300.00"), "renderer must not recompute money from lines")
    }

    func testMoneyFooterHasSubtotalTaxFeeAndTotalLabels() {
        let text = BeoPrintCompute.renderText(
            event: event(), lines: [], courses: [], totals: contrivedTotals)
        XCTAssertTrue(text.contains("Subtotal"))
        XCTAssertTrue(text.contains("Tax"))
        XCTAssertTrue(text.contains("Service fee"))
        XCTAssertTrue(text.contains("Total"))
    }
}
