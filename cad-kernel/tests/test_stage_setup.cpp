#include <gtest/gtest.h>

#include <string>

#include "apple/graphics/constructs/stage_setup.hpp"
#include "apple/graphics/engine.hpp"
#include "apple/graphics/intents_bridge.hpp"

namespace {

using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::ObjectType;
using AppleGraphics::ParamMap;
using AppleGraphics::constructs::StageSetup;
namespace geom = floorplan::geom;
namespace audio = AppleAudio;

using ElementKind = StageSetup::ElementKind;

// Element footprint declared in stage_setup.cpp (20x20). Mirror it here for
// hit-test probes.
constexpr double kW = 20.0;
constexpr double kH = 20.0;

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

TEST(StageSetup, ConstructorCreatesStageRoot) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    EXPECT_EQ(engine.typeOf(stage.rootId()), ObjectType::Rigging);
    EXPECT_EQ(stage.elementCount(), 0u);
    EXPECT_FALSE(stage.initError().has_value());
    EXPECT_FALSE(stage.splLimit().has_value());
}

TEST(StageSetup, AddChannelAndMonitorCreateRightTypesAndData) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);

    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 50.0, 50.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon1", "Wedge L", 100.0, 50.0)
                    .has_value());

    EXPECT_EQ(engine.typeOf("ch1"), ObjectType::Channel);
    EXPECT_EQ(engine.typeOf("mon1"), ObjectType::Monitor);
    ASSERT_NE(stage.element("ch1"), nullptr);
    EXPECT_EQ(stage.element("ch1")->label, "Vocal");
    EXPECT_EQ(stage.element("ch1")->kind, ElementKind::Channel);
    EXPECT_EQ(stage.element("mon1")->kind, ElementKind::Monitor);
    EXPECT_EQ(stage.elementCount(), 2u);

    // Each node is hit-testable at its world centre.
    auto pCh = worldCentre(engine, "ch1", kW, kH);
    auto hitCh = engine.hitTest(pCh);
    ASSERT_TRUE(hitCh.has_value());
    EXPECT_EQ(*hitCh, "ch1");
    auto pMon = worldCentre(engine, "mon1", kW, kH);
    auto hitMon = engine.hitTest(pMon);
    ASSERT_TRUE(hitMon.has_value());
    EXPECT_EQ(*hitMon, "mon1");
}

TEST(StageSetup, AddInstrumentAndRiggingCreateRightTypes) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);

    ASSERT_TRUE(stage.addElement(ElementKind::Instrument, "gtr", "Guitar", 0.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Rigging, "rig1", "Truss", 30.0, 0.0)
                    .has_value());

    EXPECT_EQ(engine.typeOf("gtr"), ObjectType::Instrument);
    EXPECT_EQ(engine.typeOf("rig1"), ObjectType::Rigging);
    EXPECT_EQ(stage.element("gtr")->kind, ElementKind::Instrument);
    EXPECT_EQ(stage.element("rig1")->kind, ElementKind::Rigging);
}

TEST(StageSetup, MoveElementRelocates) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 50.0, 50.0)
                    .has_value());

    const auto oldCentre = worldCentre(engine, "ch1", kW, kH);
    const auto movedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectMoved);

    ASSERT_TRUE(stage.moveElement("ch1", 150.0, 150.0).has_value());

    // Old centre no longer hits; new centre does.
    EXPECT_FALSE(engine.hitTest(oldCentre).has_value());
    auto newCentre = worldCentre(engine, "ch1", kW, kH);
    auto hit = engine.hitTest(newCentre);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "ch1");

    // x,y synced in data.
    EXPECT_EQ(stage.element("ch1")->x, 150.0);
    EXPECT_EQ(stage.element("ch1")->y, 150.0);
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectMoved),
              movedBefore + 1);
}

TEST(StageSetup, AssignToMixLinksChannelToMonitor) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 0.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon1", "Wedge", 30.0, 0.0)
                    .has_value());

    const auto reconfBefore =
        engine.synth().triggerCount(audio::SoundEvent::Reconfigured);
    const auto ops0 = engine.collab().opCount();

    ASSERT_TRUE(stage.assignToMix("ch1", "mon1").has_value());

    // Monitor lists the channel; channel points at the monitor.
    const auto& assigned = stage.element("mon1")->assignedChannels;
    ASSERT_EQ(assigned.size(), 1u);
    EXPECT_EQ(assigned[0], "ch1");
    ASSERT_TRUE(stage.element("ch1")->mixId.has_value());
    EXPECT_EQ(*stage.element("ch1")->mixId, "mon1");

    // Reconfigured cue + one collab op.
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::Reconfigured),
              reconfBefore + 1);
    EXPECT_EQ(engine.collab().opCount(), ops0 + 1);

    // Re-assigning the same pair does not duplicate.
    ASSERT_TRUE(stage.assignToMix("ch1", "mon1").has_value());
    EXPECT_EQ(stage.element("mon1")->assignedChannels.size(), 1u);
}

TEST(StageSetup, AssignToMixReassignsToDifferentMonitorWithoutDangling) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch", "Vocal", 0.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon1", "Wedge L", 30.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon2", "Wedge R", 60.0, 0.0)
                    .has_value());

    // First assignment: ch -> mon1.
    ASSERT_TRUE(stage.assignToMix("ch", "mon1").has_value());
    {
        const auto& a1 = stage.element("mon1")->assignedChannels;
        ASSERT_EQ(a1.size(), 1u);
        EXPECT_EQ(a1[0], "ch");
        ASSERT_TRUE(stage.element("ch")->mixId.has_value());
        EXPECT_EQ(*stage.element("ch")->mixId, "mon1");
    }

    // Reassign to a DIFFERENT monitor: mon1 must no longer reference ch, mon2 must.
    ASSERT_TRUE(stage.assignToMix("ch", "mon2").has_value());
    EXPECT_TRUE(stage.element("mon1")->assignedChannels.empty());
    {
        const auto& a2 = stage.element("mon2")->assignedChannels;
        ASSERT_EQ(a2.size(), 1u);
        EXPECT_EQ(a2[0], "ch");
        ASSERT_TRUE(stage.element("ch")->mixId.has_value());
        EXPECT_EQ(*stage.element("ch")->mixId, "mon2");
    }

    // Re-assigning to the SAME (current) monitor remains an idempotent no-dup.
    ASSERT_TRUE(stage.assignToMix("ch", "mon2").has_value());
    EXPECT_EQ(stage.element("mon2")->assignedChannels.size(), 1u);
    EXPECT_TRUE(stage.element("mon1")->assignedChannels.empty());
    EXPECT_EQ(*stage.element("ch")->mixId, "mon2");
}

TEST(StageSetup, AssignToMixRejectsBadIdsAndKinds) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 0.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon1", "Wedge", 30.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Instrument, "gtr", "Guitar", 60.0, 0.0)
                    .has_value());

    // Unknown ids.
    EXPECT_FALSE(stage.assignToMix("nope", "mon1").has_value());
    EXPECT_FALSE(stage.assignToMix("ch1", "nope").has_value());
    // Non-channel as channel.
    EXPECT_FALSE(stage.assignToMix("gtr", "mon1").has_value());
    // Non-monitor as monitor.
    EXPECT_FALSE(stage.assignToMix("ch1", "gtr").has_value());

    // Nothing was linked.
    EXPECT_TRUE(stage.element("mon1")->assignedChannels.empty());
    EXPECT_FALSE(stage.element("ch1")->mixId.has_value());
}

TEST(StageSetup, SetSplLimitSetsAndRejectsNegativeViaIntent) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);

    const auto reconfBefore =
        engine.synth().triggerCount(audio::SoundEvent::Reconfigured);

    ASSERT_TRUE(stage.setSplLimit(105.0).has_value());
    ASSERT_TRUE(stage.splLimit().has_value());
    EXPECT_EQ(*stage.splLimit(), 105.0);
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::Reconfigured),
              reconfBefore + 1);

    // Typed method rejects negative.
    EXPECT_FALSE(stage.setSplLimit(-1.0).has_value());

    // Intent path rejects via minValue before the handler runs.
    ParamMap bad{{"db", -5.0}};
    auto r = engine.intents().dispatch("SetSplLimit", bad);
    EXPECT_FALSE(r.has_value());
    EXPECT_EQ(*stage.splLimit(), 105.0);
}

TEST(StageSetup, RemoveChannelCleansMonitorReference) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 0.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon1", "Wedge", 30.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.assignToMix("ch1", "mon1").has_value());

    const auto removedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectRemoved);

    ASSERT_TRUE(stage.removeElement("ch1").has_value());

    // Channel node + data gone; monitor no longer references it.
    EXPECT_EQ(stage.element("ch1"), nullptr);
    EXPECT_FALSE(engine.typeOf("ch1").has_value());
    EXPECT_TRUE(stage.element("mon1")->assignedChannels.empty());
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectRemoved),
              removedBefore + 1);
}

TEST(StageSetup, RemoveMonitorClearsChannelMixIds) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 0.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch2", "Snare", 30.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon1", "Wedge", 60.0, 0.0)
                    .has_value());
    ASSERT_TRUE(stage.assignToMix("ch1", "mon1").has_value());
    ASSERT_TRUE(stage.assignToMix("ch2", "mon1").has_value());

    ASSERT_TRUE(stage.removeElement("mon1").has_value());

    // Monitor gone; both channels had their mixId cleared.
    EXPECT_EQ(stage.element("mon1"), nullptr);
    EXPECT_FALSE(engine.typeOf("mon1").has_value());
    EXPECT_FALSE(stage.element("ch1")->mixId.has_value());
    EXPECT_FALSE(stage.element("ch2")->mixId.has_value());
}

TEST(StageSetup, IntentRoundTripsForAddChannelMonitorAssignSplRemove) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);

    ParamMap addCh{
        {"id", std::string{"ch1"}},
        {"label", std::string{"Vocal"}},
        {"x", 0.0},
        {"y", 0.0},
    };
    auto rCh = engine.intents().dispatch("AddChannel", addCh);
    ASSERT_TRUE(rCh.has_value());
    EXPECT_EQ(rCh->targetId, std::optional<std::string>{"ch1"});
    EXPECT_EQ(engine.typeOf("ch1"), ObjectType::Channel);

    ParamMap addMon{
        {"id", std::string{"mon1"}},
        {"label", std::string{"Wedge"}},
        {"x", 30.0},
        {"y", 0.0},
    };
    ASSERT_TRUE(engine.intents().dispatch("AddMonitor", addMon).has_value());
    EXPECT_EQ(engine.typeOf("mon1"), ObjectType::Monitor);

    ParamMap assign{
        {"channelId", std::string{"ch1"}},
        {"monitorId", std::string{"mon1"}},
    };
    ASSERT_TRUE(engine.intents().dispatch("AssignToMix", assign).has_value());
    EXPECT_EQ(stage.element("mon1")->assignedChannels.size(), 1u);

    ParamMap spl{{"db", 100.0}};
    ASSERT_TRUE(engine.intents().dispatch("SetSplLimit", spl).has_value());
    EXPECT_EQ(*stage.splLimit(), 100.0);

    ParamMap remove{{"id", std::string{"ch1"}}};
    ASSERT_TRUE(engine.intents().dispatch("RemoveElement", remove).has_value());
    EXPECT_EQ(stage.element("ch1"), nullptr);
}

TEST(StageSetup, IntentRejectsMissingParams) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);

    // Missing x/y for AddChannel.
    ParamMap badAdd{
        {"id", std::string{"ch1"}},
        {"label", std::string{"Vocal"}},
    };
    EXPECT_FALSE(engine.intents().dispatch("AddChannel", badAdd).has_value());
    EXPECT_EQ(stage.element("ch1"), nullptr);

    // Missing monitorId for AssignToMix.
    ParamMap badAssign{{"channelId", std::string{"ch1"}}};
    EXPECT_FALSE(engine.intents().dispatch("AssignToMix", badAssign).has_value());
}

TEST(StageSetup, DuplicateRootIdSetsInitErrorAndDisablesMutations) {
    AppleUnifiedEngine engine;
    StageSetup first(engine);
    EXPECT_FALSE(first.initError().has_value());

    // A second construct with the SAME rootId collides on the root addObject. The
    // kernel uses std::expected (no exceptions), so the ctor records the error and
    // leaves the construct inert.
    StageSetup second(engine, "stage");
    ASSERT_TRUE(second.initError().has_value());

    auto r = second.addElement(ElementKind::Channel, "ch1", "X", 0.0, 0.0);
    ASSERT_FALSE(r.has_value());
    EXPECT_EQ(r.error(), *second.initError());
    EXPECT_EQ(second.elementCount(), 0u);

    // Other mutating methods are also inert.
    EXPECT_FALSE(second.moveElement("ch1", 1.0, 1.0).has_value());
    EXPECT_FALSE(second.assignToMix("ch1", "mon1").has_value());
    EXPECT_FALSE(second.setSplLimit(100.0).has_value());
    EXPECT_FALSE(second.removeElement("ch1").has_value());
}

TEST(StageSetup, DuplicateIdAndUnknownElementFail) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);
    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 0.0, 0.0)
                    .has_value());
    EXPECT_FALSE(stage.addElement(ElementKind::Monitor, "ch1", "Dup", 0.0, 0.0)
                     .has_value());

    EXPECT_FALSE(stage.moveElement("nope", 1.0, 1.0).has_value());
    EXPECT_FALSE(stage.removeElement("nope").has_value());
}

TEST(StageSetup, CollabAndSynthCountsTrackMutations) {
    AppleUnifiedEngine engine;
    StageSetup stage(engine);

    const auto ops0 = engine.collab().opCount();
    const auto trig0 = engine.synth().totalTriggers();

    ASSERT_TRUE(stage.addElement(ElementKind::Channel, "ch1", "Vocal", 0.0, 0.0)
                    .has_value());                                              // +1/+1
    ASSERT_TRUE(stage.addElement(ElementKind::Monitor, "mon1", "Wedge", 30.0, 0.0)
                    .has_value());                                             // +1/+1
    ASSERT_TRUE(stage.moveElement("ch1", 50.0, 50.0).has_value());            // +1/+1
    ASSERT_TRUE(stage.assignToMix("ch1", "mon1").has_value());                // +1/+1
    ASSERT_TRUE(stage.setSplLimit(105.0).has_value());                        // +1/+1
    ASSERT_TRUE(stage.removeElement("ch1").has_value());                      // +1/+1

    EXPECT_EQ(engine.collab().opCount(), ops0 + 6);
    EXPECT_EQ(engine.synth().totalTriggers(), trig0 + 6);
}

} // namespace
