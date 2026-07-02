import XCTest
@testable import LariatModel

/// Parity tests for `BeoCascadeClient` — port of `lib/beoCascade.ts` (the
/// spawn wrapper around `scripts/beo_cascade_cli.py`). Oracle:
/// `tests/js/test-beo-cascade.mjs` + the wrapper's parse/coercion rules.
/// The runner is injected so no Python is spawned in tests; the recorded
/// outputs mirror the CLI's documented JSON shapes.
final class BeoCascadeClientTests: XCTestCase {

    private func client(_ output: String) -> BeoCascadeClient {
        BeoCascadeClient(runner: { _, _ in output })
    }

    // ── empty short-circuit (test-beo-cascade.mjs case 3) ────────────────

    func testEmptyLineItemsShortCircuitWithoutSpawning() async throws {
        var spawned = false
        let c = BeoCascadeClient(runner: { _, _ in spawned = true; return "{}" })
        let r = try await c.cascadeFromLineItems([])
        XCTAssertEqual(r, CascadeResult(orderGuide: [], prepDemands: [], unmapped: []))
        XCTAssertFalse(spawned, "empty line items must not spawn the CLI")
    }

    // ── happy-path parse (CLI docstring shapes) ──────────────────────────

    func testParsesFullCascadeResponse() async throws {
        let raw = """
        {"order_guide": [{"ingredient": "flour", "unit": "lb", "total_needed": 10.0, "on_hand": 5.0, "to_order": 5.0}],
         "prep_demands": [{"recipe_slug": "beer_batter", "display_name": "Beer Batter", "qty": 4.0, "unit": "qt"}],
         "unmapped": [{"menu_item": "Mystery Dish", "reason": "not in beo_recipe_map and no direct recipe match"}]}
        """
        let r = try await client(raw).cascadeFromLineItems(
            [.init(itemName: "Battered Fish Taco", quantity: 40)])
        XCTAssertEqual(r.orderGuide, [
            CascadeOrderGuideRow(ingredient: "flour", unit: "lb", totalNeeded: 10, onHand: 5, toOrder: 5),
        ])
        XCTAssertEqual(r.prepDemands, [
            CascadePrepDemandRow(recipeSlug: "beer_batter", displayName: "Beer Batter", qty: 4, unit: "qt"),
        ])
        XCTAssertEqual(r.unmapped, [
            CascadeUnmappedRow(menuItem: "Mystery Dish", reason: "not in beo_recipe_map and no direct recipe match"),
        ])
    }

    func testBogusItemRoundTripsToUnmapped() async throws {
        // test-beo-cascade.mjs case 1, with the CLI's recorded response shape.
        let bogus = "__definitely_not_a_real_item__"
        let raw = """
        {"order_guide": [], "prep_demands": [],
         "unmapped": [{"menu_item": "\(bogus)", "reason": "not in beo_recipe_map and no direct recipe match"}]}
        """
        let r = try await client(raw).cascadeFromLineItems([.init(itemName: bogus, quantity: 1)])
        XCTAssertTrue(r.orderGuide.isEmpty)
        XCTAssertTrue(r.prepDemands.isEmpty)
        XCTAssertEqual(r.unmapped.count, 1)
        XCTAssertEqual(r.unmapped[0].menuItem, bogus)
        XCTAssertFalse(r.unmapped[0].reason.isEmpty)
    }

    func testCoercesMissingRowFieldsLikeTheWebWrapper() async throws {
        // Web: String(row.x ?? ''), Number(row.x ?? 0).
        let raw = """
        {"order_guide": [{"ingredient": "flour"}], "prep_demands": [{}], "unmapped": [{}]}
        """
        let r = try await client(raw).cascadeFromLineItems([.init(itemName: "x", quantity: 1)])
        XCTAssertEqual(r.orderGuide, [
            CascadeOrderGuideRow(ingredient: "flour", unit: "", totalNeeded: 0, onHand: 0, toOrder: 0),
        ])
        XCTAssertEqual(r.prepDemands, [
            CascadePrepDemandRow(recipeSlug: "", displayName: "", qty: 0, unit: ""),
        ])
        XCTAssertEqual(r.unmapped, [CascadeUnmappedRow(menuItem: "", reason: "")])
    }

    // ── typed CascadeError codes ─────────────────────────────────────────

    func testInvalidJsonThrowsBadJson() async {
        await assertCascadeError(code: "bad_json") {
            _ = try await self.client("not json").cascadeFromLineItems([.init(itemName: "x", quantity: 1)])
        }
    }

    func testNonObjectThrowsBadShape() async {
        await assertCascadeError(code: "bad_shape") {
            _ = try await self.client("[1,2,3]").cascadeFromLineItems([.init(itemName: "x", quantity: 1)])
        }
    }

    func testErrorFieldThrowsCliError() async {
        await assertCascadeError(code: "cli_error") {
            _ = try await self.client(#"{"error": "missing recipe_index.csv"}"#)
                .cascadeFromLineItems([.init(itemName: "x", quantity: 1)])
        }
    }

    func testMissingArraysThrowsBadShape() async {
        await assertCascadeError(code: "bad_shape") {
            _ = try await self.client(#"{"order_guide": []}"#)
                .cascadeFromLineItems([.init(itemName: "x", quantity: 1)])
        }
    }

    func testRunnerFailurePropagatesCascadeError() async {
        // test-beo-cascade.mjs case 2 (CLI failure → typed CascadeError with a code).
        let c = BeoCascadeClient(runner: { _, _ in
            throw CascadeError(message: "missing recipe_index.csv at /nonexistent-root-xyz", code: "exit_2")
        })
        await assertCascadeError(code: "exit_2") {
            _ = try await c.cascadeFromLineItems([.init(itemName: "anything", quantity: 1)])
        }
    }

    // ── payload construction (CLI stdin contract) ────────────────────────

    func testBuildPayloadCarriesLineItemsRootAndYieldFlag() throws {
        let data = try BeoCascadeClient.buildPayload(
            lineItems: [.init(itemName: "Battered Fish Taco", quantity: 40)],
            root: "/abs/root",
            qtyInYieldUnits: true,
            inventory: nil
        )
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj["root"] as? String, "/abs/root")
        XCTAssertEqual(obj["qty_in_yield_units"] as? Bool, true)
        let items = try XCTUnwrap(obj["line_items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0]["item_name"] as? String, "Battered Fish Taco")
        XCTAssertEqual((items[0]["quantity"] as? NSNumber)?.doubleValue, 40)
        // inventory omitted (web: only added when opts.inventory !== undefined)
        XCTAssertNil(obj["inventory"])
    }

    func testBuildPayloadIncludesInventoryWhenProvided() throws {
        let data = try BeoCascadeClient.buildPayload(
            lineItems: [.init(itemName: "x", quantity: 1)],
            root: "/r",
            qtyInYieldUnits: false,
            inventory: [.init(ingredient: "flour", unit: "lb", onHand: 5)]
        )
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let inv = try XCTUnwrap(obj["inventory"] as? [[String: Any]])
        XCTAssertEqual(inv[0]["ingredient"] as? String, "flour")
        XCTAssertEqual(inv[0]["unit"] as? String, "lb")
        XCTAssertEqual((inv[0]["on_hand"] as? NSNumber)?.doubleValue, 5)
    }

    // ── root resolution (web: LARIAT_ROOT || cwd) ────────────────────────

    func testResolveProjectRootPrefersLariatRoot() {
        XCTAssertEqual(
            BeoCascadeClient.resolveProjectRoot(env: ["LARIAT_ROOT": "/from/env"], cwd: "/cwd"),
            "/from/env"
        )
        XCTAssertEqual(BeoCascadeClient.resolveProjectRoot(env: [:], cwd: "/cwd"), "/cwd")
    }

    // ── helper ───────────────────────────────────────────────────────────

    private func assertCascadeError(
        code: String,
        _ body: () async throws -> Void,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            try await body()
            XCTFail("expected CascadeError(\(code))", file: file, line: line)
        } catch let e as CascadeError {
            XCTAssertEqual(e.code, code, file: file, line: line)
        } catch {
            XCTFail("expected CascadeError, got \(error)", file: file, line: line)
        }
    }
}
