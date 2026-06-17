import XCTest
@testable import LariatModel

final class StationProgressTests: XCTestCase {
    private let grill = KitchenStation(id: "grill_saute", name: "Grill / Sauté", line: "hot", lineCheckKey: "grille_saute")
    private let runner = KitchenStation(id: "runner", name: "Runner", line: "foh", lineCheckKey: nil)

    func testProgressCountsDoneAndFlagged() {
        let template = ["Cornbread", "Mayo", "Bacon Jam"]
        let entries = [
            LineCheckItemStatus(item: "Cornbread", status: "pass"),
            LineCheckItemStatus(item: "Mayo", status: "fail"),
        ]
        let p = StationProgressCompute.progress(templateItems: template, entries: entries, signedOff: false)
        XCTAssertEqual(p?.total, 3)
        XCTAssertEqual(p?.done, 2)
        XCTAssertEqual(p?.flagged, 1)
        XCTAssertFalse(p?.signedOff ?? true)
    }

    func testProgressNilWhenTemplateEmpty() {
        XCTAssertNil(StationProgressCompute.progress(templateItems: [], entries: [], signedOff: false))
    }

    func testActiveLineCheckStationsFiltersPositionOnly() {
        let stations = [
            StationWithProgress(station: grill, progress: StationProgress(total: 3, done: 1, flagged: 0, signedOff: false)),
            StationWithProgress(station: runner, progress: nil),
        ]
        XCTAssertEqual(StationProgressCompute.activeLineCheckStations(stations).map(\.station.id), ["grill_saute"])
    }

    func testReadyAndFlaggedHeroStats() {
        let fry = KitchenStation(id: "fry", name: "Fry", line: "hot", lineCheckKey: "fry")
        let stations = [
            StationWithProgress(station: grill, progress: StationProgress(total: 3, done: 3, flagged: 0, signedOff: true)),
            StationWithProgress(station: fry, progress: StationProgress(total: 2, done: 1, flagged: 1, signedOff: false)),
            StationWithProgress(station: runner, progress: nil),
        ]
        XCTAssertEqual(StationProgressCompute.readyCount(stations), 1)
        XCTAssertEqual(StationProgressCompute.flaggedCount(stations), 1)
    }

    func testCascadeWalksParents() {
        let recipes = [
            RecipeCatalogEntry(slug: "bisque", name: "Lobster Bisque", subRecipes: []),
            RecipeCatalogEntry(slug: "surf_turf", name: "Surf & Turf", subRecipes: ["bisque"]),
        ]
        let cascaded = SubRecipeCascadeCompute.cascadedFromEightySix(
            itemsEightySixed: ["Lobster Bisque"],
            recipes: recipes
        )
        XCTAssertEqual(cascaded.map(\.slug), ["surf_turf"])
        XCTAssertEqual(cascaded.first?.via, "Lobster Bisque")
    }


    func testCascadeAsciiTokenizationOnAccentedNames() {
        // Web splits "Sauté Special" → ["saut", "special"]; Unicode word chars would keep "sauté".
        let recipes = [
            RecipeCatalogEntry(slug: "saut_special", name: "Sauté Special", subRecipes: []),
            RecipeCatalogEntry(slug: "plate", name: "Plate", subRecipes: ["saut_special"]),
        ]
        let cascaded = SubRecipeCascadeCompute.cascadedFromEightySix(
            itemsEightySixed: ["saut special"],
            recipes: recipes
        )
        XCTAssertEqual(cascaded.map(\.slug), ["plate"])
    }

    func testStationLabelsMatchWebToneOrder() {
        XCTAssertEqual(StationProgressLabels.label(for: nil), "No line check")
        XCTAssertEqual(StationProgressLabels.label(for: StationProgress(total: 4, done: 2, flagged: 1, signedOff: false)), "1 flagged")
        XCTAssertEqual(StationProgressLabels.label(for: StationProgress(total: 4, done: 4, flagged: 0, signedOff: false)), "Ready")
        XCTAssertEqual(StationProgressLabels.tone(for: StationProgress(total: 4, done: 2, flagged: 0, signedOff: false)), .amber)
    }
}
