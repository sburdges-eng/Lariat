#include <gtest/gtest.h>

#include <cstdint>
#include <string>

#include "apple/graphics/constructs/floor_plan.hpp"
#include "apple/graphics/engine.hpp"
#include "apple/graphics/intents_bridge.hpp"

namespace {

using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::ObjectType;
using AppleGraphics::ParamMap;
using AppleGraphics::constructs::FloorPlan;
namespace geom = floorplan::geom;
namespace audio = AppleAudio;

// Returns a world point inside node `id`'s local bounds {0,0,w,h} by mapping the
// local centre (w/2, h/2) through the node's global transform. Proves the
// construct registered the node in the engine's quadtree at the right place.
geom::Vertex2D worldCentre(const AppleUnifiedEngine& engine, const std::string& id,
                           double w, double h) {
    auto gt = engine.globalTransformOf(id);
    EXPECT_TRUE(gt.has_value());
    auto [x, y] = gt->transformPoint(w / 2.0, h / 2.0);
    return geom::Vertex2D{x, y};
}

TEST(FloorPlan, ConstructorCreatesFloorRoot) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);
    EXPECT_EQ(engine.typeOf(floor.rootId()), ObjectType::Table);
    EXPECT_EQ(floor.tableCount(), 0u);
    EXPECT_FALSE(floor.initError().has_value());
}

TEST(FloorPlan, AddTableCreatesSceneNodeAndData) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);

    ASSERT_TRUE(floor.addTable("t1", "Booth 1", 4, 50.0, 50.0, 20.0, 20.0).has_value());
    EXPECT_EQ(engine.typeOf("t1"), ObjectType::Table);
    ASSERT_NE(floor.table("t1"), nullptr);
    EXPECT_EQ(floor.table("t1")->label, "Booth 1");
    EXPECT_EQ(floor.table("t1")->capacity, 4);
    EXPECT_EQ(floor.table("t1")->status, "open");
    EXPECT_EQ(floor.table("t1")->w, 20.0);
    EXPECT_EQ(floor.table("t1")->h, 20.0);
    EXPECT_EQ(floor.tableCount(), 1u);

    // The node is hit-testable at its world centre.
    auto p = worldCentre(engine, "t1", 20.0, 20.0);
    auto hit = engine.hitTest(p);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "t1");
}

TEST(FloorPlan, MoveTableRelocates) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);
    ASSERT_TRUE(floor.addTable("t1", "Booth 1", 4, 50.0, 50.0, 20.0, 20.0).has_value());

    const auto oldCentre = worldCentre(engine, "t1", 20.0, 20.0);
    const auto movedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectMoved);

    ASSERT_TRUE(floor.moveTable("t1", 150.0, 150.0).has_value());

    // Old centre no longer hits; new centre does.
    EXPECT_FALSE(engine.hitTest(oldCentre).has_value());
    auto newCentre = worldCentre(engine, "t1", 20.0, 20.0);
    auto hit = engine.hitTest(newCentre);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "t1");

    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectMoved),
              movedBefore + 1);
}

TEST(FloorPlan, ResizeTableEnlargesBoundsAndPreservesData) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);
    // Small table at origin: local bounds {0,0,10,10}, placed at (0,0).
    ASSERT_TRUE(floor.addTable("t1", "Booth 1", 4, 0.0, 0.0, 10.0, 10.0).has_value());
    ASSERT_TRUE(floor.setTableStatus("t1", "seated").has_value());

    // A point inside the NEW bounds but outside the old (local (15,15)) should
    // miss before the resize.
    const geom::Vertex2D probe{15.0, 15.0};
    EXPECT_FALSE(engine.hitTest(probe).has_value());

    const auto reconfBefore =
        engine.synth().triggerCount(audio::SoundEvent::Reconfigured);

    ASSERT_TRUE(floor.resizeTable("t1", 40.0, 40.0).has_value());

    // Geometry updated; non-geometry data preserved across the remove+re-add.
    ASSERT_NE(floor.table("t1"), nullptr);
    EXPECT_EQ(floor.table("t1")->w, 40.0);
    EXPECT_EQ(floor.table("t1")->h, 40.0);
    EXPECT_EQ(floor.table("t1")->label, "Booth 1");
    EXPECT_EQ(floor.table("t1")->capacity, 4);
    EXPECT_EQ(floor.table("t1")->status, "seated");
    EXPECT_EQ(floor.tableCount(), 1u);

    // The probe now hits the enlarged table.
    auto hit = engine.hitTest(probe);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "t1");

    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::Reconfigured),
              reconfBefore + 1);
}

TEST(FloorPlan, SetTableStatusUpdatesAndRejectsInvalid) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);
    ASSERT_TRUE(floor.addTable("t1", "Booth 1", 4, 0.0, 0.0, 20.0, 20.0).has_value());

    const auto reconfBefore =
        engine.synth().triggerCount(audio::SoundEvent::Reconfigured);

    ASSERT_TRUE(floor.setTableStatus("t1", "dirty").has_value());
    EXPECT_EQ(floor.table("t1")->status, "dirty");
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::Reconfigured),
              reconfBefore + 1);

    // Typed method rejects an out-of-set status.
    EXPECT_FALSE(floor.setTableStatus("t1", "bogus").has_value());
    EXPECT_EQ(floor.table("t1")->status, "dirty");

    // Intent path rejects via allowedValues before the handler runs.
    ParamMap bad{
        {"id", std::string{"t1"}},
        {"status", std::string{"bogus"}},
    };
    auto r = engine.intents().dispatch("SetTableStatus", bad);
    EXPECT_FALSE(r.has_value());
    EXPECT_EQ(floor.table("t1")->status, "dirty");
}

TEST(FloorPlan, RemoveTableRemovesNodeAndData) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);
    ASSERT_TRUE(floor.addTable("t1", "Booth 1", 4, 0.0, 0.0, 20.0, 20.0).has_value());
    ASSERT_EQ(floor.tableCount(), 1u);

    const auto removedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectRemoved);

    ASSERT_TRUE(floor.removeTable("t1").has_value());
    EXPECT_EQ(floor.table("t1"), nullptr);
    EXPECT_EQ(floor.tableCount(), 0u);
    EXPECT_FALSE(engine.typeOf("t1").has_value());
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectRemoved),
              removedBefore + 1);
}

TEST(FloorPlan, AutoLayoutCreatesTablesFromOptimizer) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);

    const auto ops0 = engine.collab().opCount();
    const auto added0 = engine.synth().triggerCount(audio::SoundEvent::ObjectAdded);

    ASSERT_TRUE(floor.autoLayout(1.0).has_value());

    // SeatingOptimizer is currently a STUB returning exactly 2 placements; assert
    // that count. (This will scale up when the kernel op is implemented.)
    EXPECT_EQ(floor.tableCount(), 2u);
    ASSERT_NE(floor.table("auto-0"), nullptr);
    ASSERT_NE(floor.table("auto-1"), nullptr);
    EXPECT_EQ(floor.table("auto-0")->capacity, 2); // table_type 2
    EXPECT_EQ(floor.table("auto-1")->capacity, 4); // table_type 4
    EXPECT_EQ(engine.typeOf("auto-0"), ObjectType::Table);

    // One collab op + one ObjectAdded cue per created table.
    EXPECT_EQ(engine.collab().opCount(), ops0 + 2);
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectAdded),
              added0 + 2);
}

TEST(FloorPlan, AutoLayoutRejectsNegativeClearance) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);
    EXPECT_FALSE(floor.autoLayout(-1.0).has_value());
    EXPECT_EQ(floor.tableCount(), 0u);
}

TEST(FloorPlan, IntentRoundTripCreatesTable) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);

    ParamMap params{
        {"id", std::string{"t1"}},
        {"label", std::string{"Booth 1"}},
        {"capacity", std::int64_t{4}},
        {"x", 50.0},
        {"y", 50.0},
        {"w", 20.0},
        {"h", 20.0},
    };
    auto r = engine.intents().dispatch("AddTable", params);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->targetId, std::optional<std::string>{"t1"});

    ASSERT_NE(floor.table("t1"), nullptr);
    EXPECT_EQ(floor.table("t1")->capacity, 4);
    EXPECT_EQ(engine.typeOf("t1"), ObjectType::Table);
}

TEST(FloorPlan, IntentRejectsBadCapacityAndDimensions) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);

    // capacity < 1 rejected by minValue.
    ParamMap badCap{
        {"id", std::string{"bad1"}},   {"label", std::string{"X"}},
        {"capacity", std::int64_t{0}}, {"x", 0.0},
        {"y", 0.0},                    {"w", 20.0},
        {"h", 20.0},
    };
    EXPECT_FALSE(engine.intents().dispatch("AddTable", badCap).has_value());
    EXPECT_EQ(floor.table("bad1"), nullptr);

    // w <= 0 rejected by minValue.
    ParamMap badW{
        {"id", std::string{"bad2"}},   {"label", std::string{"X"}},
        {"capacity", std::int64_t{4}}, {"x", 0.0},
        {"y", 0.0},                    {"w", 0.0},
        {"h", 20.0},
    };
    EXPECT_FALSE(engine.intents().dispatch("AddTable", badW).has_value());
    EXPECT_EQ(floor.table("bad2"), nullptr);
}

TEST(FloorPlan, DuplicateRootIdSetsInitErrorAndDisablesMutations) {
    AppleUnifiedEngine engine;
    FloorPlan first(engine);
    EXPECT_FALSE(first.initError().has_value());

    // A second construct with the SAME rootId collides on the root addObject. The
    // kernel uses std::expected (no exceptions), so the ctor records the error and
    // leaves the construct inert.
    FloorPlan second(engine, "floor");
    ASSERT_TRUE(second.initError().has_value());

    auto r = second.addTable("t1", "X", 4, 0.0, 0.0, 20.0, 20.0);
    ASSERT_FALSE(r.has_value());
    EXPECT_EQ(r.error(), *second.initError());
    EXPECT_EQ(second.tableCount(), 0u);
}

TEST(FloorPlan, CollabAndSynthCountsTrackMutations) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);

    const auto ops0 = engine.collab().opCount();
    const auto trig0 = engine.synth().totalTriggers();

    ASSERT_TRUE(floor.addTable("t1", "Booth 1", 4, 0.0, 0.0, 20.0, 20.0).has_value()); // +1/+1
    ASSERT_TRUE(floor.moveTable("t1", 50.0, 50.0).has_value());                        // +1/+1
    ASSERT_TRUE(floor.resizeTable("t1", 30.0, 30.0).has_value());                      // +1/+1
    ASSERT_TRUE(floor.setTableStatus("t1", "seated").has_value());                     // +1/+1
    ASSERT_TRUE(floor.removeTable("t1").has_value());                                  // +1/+1

    EXPECT_EQ(engine.collab().opCount(), ops0 + 5);
    EXPECT_EQ(engine.synth().totalTriggers(), trig0 + 5);
}

TEST(FloorPlan, DuplicateIdAndUnknownTableFail) {
    AppleUnifiedEngine engine;
    FloorPlan floor(engine);
    ASSERT_TRUE(floor.addTable("t1", "Booth 1", 4, 0.0, 0.0, 20.0, 20.0).has_value());
    EXPECT_FALSE(floor.addTable("t1", "Dup", 4, 0.0, 0.0, 20.0, 20.0).has_value());

    EXPECT_FALSE(floor.moveTable("nope", 1.0, 1.0).has_value());
    EXPECT_FALSE(floor.resizeTable("nope", 5.0, 5.0).has_value());
    EXPECT_FALSE(floor.setTableStatus("nope", "open").has_value());
    EXPECT_FALSE(floor.removeTable("nope").has_value());
}

} // namespace
