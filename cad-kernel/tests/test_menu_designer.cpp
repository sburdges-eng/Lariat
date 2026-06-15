#include <gtest/gtest.h>

#include <cstdint>
#include <string>

#include "apple/graphics/constructs/menu_designer.hpp"
#include "apple/graphics/engine.hpp"
#include "apple/graphics/intents_bridge.hpp"

namespace {

using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::ObjectType;
using AppleGraphics::ParamMap;
using AppleGraphics::constructs::MenuDesigner;
namespace geom = floorplan::geom;
namespace audio = AppleAudio;

// Returns a world point inside the node `id`'s local bounds {0,0,w,h} by mapping
// the local centre (w/2, h/2) through the node's global transform. This proves
// the construct registered the node in the engine's quadtree at the right place.
geom::Vertex2D worldCentre(const AppleUnifiedEngine& engine, const std::string& id,
                           double w, double h) {
    auto gt = engine.globalTransformOf(id);
    EXPECT_TRUE(gt.has_value());
    auto [x, y] = gt->transformPoint(w / 2.0, h / 2.0);
    return geom::Vertex2D{x, y};
}

constexpr double kItemW = 220.0;
constexpr double kItemH = 24.0;

TEST(MenuDesigner, ConstructorCreatesMenuRoot) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    EXPECT_EQ(engine.typeOf(menu.rootId()), ObjectType::MenuSection);
    EXPECT_EQ(menu.itemCount(), 0u);
    EXPECT_EQ(menu.sectionCount(), 0u);
}

TEST(MenuDesigner, AddSectionAndItemCreateSceneNodesAndData) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);

    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    EXPECT_EQ(engine.typeOf("apps"), ObjectType::MenuSection);
    ASSERT_NE(menu.section("apps"), nullptr);
    EXPECT_EQ(menu.section("apps")->name, "Appetizers");

    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());
    EXPECT_EQ(engine.typeOf("wings"), ObjectType::MenuItem);
    ASSERT_NE(menu.item("wings"), nullptr);
    EXPECT_EQ(menu.item("wings")->name, "Wings");
    EXPECT_EQ(menu.item("wings")->priceCents, 1200);
    EXPECT_EQ(menu.item("wings")->sectionId, "apps");
    EXPECT_EQ(menu.itemCount(), 1u);
}

TEST(MenuDesigner, HitTestResolvesItemNode) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());

    auto p = worldCentre(engine, "wings", kItemW, kItemH);
    auto hit = engine.hitTest(p);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "wings");
}

TEST(MenuDesigner, SetItemPriceUpdatesDataAndCues) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());

    const auto opsBefore = engine.collab().opCount();
    const auto reconfBefore =
        engine.synth().triggerCount(audio::SoundEvent::Reconfigured);

    ASSERT_TRUE(menu.setItemPrice("wings", 1500).has_value());
    EXPECT_EQ(menu.item("wings")->priceCents, 1500);
    EXPECT_EQ(engine.collab().opCount(), opsBefore + 1);
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::Reconfigured),
              reconfBefore + 1);
}

TEST(MenuDesigner, RenameItemUpdatesDataAndCues) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());

    const auto opsBefore = engine.collab().opCount();
    const auto reconfBefore =
        engine.synth().triggerCount(audio::SoundEvent::Reconfigured);

    ASSERT_TRUE(menu.renameItem("wings", "Buffalo Wings").has_value());
    EXPECT_EQ(menu.item("wings")->name, "Buffalo Wings");
    EXPECT_EQ(engine.collab().opCount(), opsBefore + 1);
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::Reconfigured),
              reconfBefore + 1);
}

TEST(MenuDesigner, MoveItemToSectionReparents) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    ASSERT_TRUE(menu.addSection("mains", "Mains").has_value());
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());

    const auto movedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectMoved);

    ASSERT_TRUE(menu.moveItemToSection("wings", "mains").has_value());

    // Domain data follows the reparent (price/name preserved, section updated).
    ASSERT_NE(menu.item("wings"), nullptr);
    EXPECT_EQ(menu.item("wings")->sectionId, "mains");
    EXPECT_EQ(menu.item("wings")->name, "Wings");
    EXPECT_EQ(menu.item("wings")->priceCents, 1200);
    EXPECT_EQ(menu.itemCount(), 1u);

    // The node is still hit-testable at its new world location (under "mains").
    auto p = worldCentre(engine, "wings", kItemW, kItemH);
    auto hit = engine.hitTest(p);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "wings");

    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectMoved),
              movedBefore + 1);
}

TEST(MenuDesigner, RemoveItemRemovesNodeAndData) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());
    ASSERT_EQ(menu.itemCount(), 1u);

    const auto removedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectRemoved);

    ASSERT_TRUE(menu.removeItem("wings").has_value());
    EXPECT_EQ(menu.item("wings"), nullptr);
    EXPECT_EQ(menu.itemCount(), 0u);
    EXPECT_FALSE(engine.typeOf("wings").has_value());
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectRemoved),
              removedBefore + 1);
}

TEST(MenuDesigner, IntentRoundTripCreatesItem) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());

    ParamMap params{
        {"sectionId", std::string{"apps"}},
        {"id", std::string{"fries"}},
        {"name", std::string{"Fries"}},
        {"priceCents", std::int64_t{600}},
    };
    auto r = engine.intents().dispatch("AddMenuItem", params);
    ASSERT_TRUE(r.has_value());
    EXPECT_EQ(r->targetId, std::optional<std::string>{"fries"});

    // The schema+handler path actually created the item (data + scene node).
    ASSERT_NE(menu.item("fries"), nullptr);
    EXPECT_EQ(menu.item("fries")->priceCents, 600);
    EXPECT_EQ(engine.typeOf("fries"), ObjectType::MenuItem);
}

TEST(MenuDesigner, IntentRejectsMissingParam) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());

    // Missing required "name" and "priceCents" — bridge validation must reject
    // before the handler runs, so no item is created.
    ParamMap params{
        {"sectionId", std::string{"apps"}},
        {"id", std::string{"bad"}},
    };
    auto r = engine.intents().dispatch("AddMenuItem", params);
    EXPECT_FALSE(r.has_value());
    EXPECT_EQ(menu.item("bad"), nullptr);
}

TEST(MenuDesigner, IntentRejectsNegativePrice) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());

    ParamMap params{
        {"sectionId", std::string{"apps"}},
        {"id", std::string{"bad"}},
        {"name", std::string{"Bad"}},
        {"priceCents", std::int64_t{-1}},
    };
    auto r = engine.intents().dispatch("AddMenuItem", params);
    EXPECT_FALSE(r.has_value());
    EXPECT_EQ(menu.item("bad"), nullptr);
}

TEST(MenuDesigner, CollabAndSynthCountsTrackMutations) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);

    // Each mutating call appends exactly one collab op and one synth trigger.
    const auto ops0 = engine.collab().opCount();
    const auto trig0 = engine.synth().totalTriggers();

    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());      // +1 / +1
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value()); // +1 / +1
    ASSERT_TRUE(menu.setItemPrice("wings", 1500).has_value());           // +1 / +1
    ASSERT_TRUE(menu.renameItem("wings", "Buffalo").has_value());        // +1 / +1
    ASSERT_TRUE(menu.addSection("mains", "Mains").has_value());          // +1 / +1
    ASSERT_TRUE(menu.moveItemToSection("wings", "mains").has_value());   // +1 / +1
    ASSERT_TRUE(menu.removeItem("wings").has_value());                   // +1 / +1

    EXPECT_EQ(engine.collab().opCount(), ops0 + 7);
    EXPECT_EQ(engine.synth().totalTriggers(), trig0 + 7);
}

TEST(MenuDesigner, DuplicateRootIdSetsInitErrorAndDisablesMutations) {
    AppleUnifiedEngine engine;
    MenuDesigner first(engine);
    EXPECT_FALSE(first.initError().has_value());

    // A second construct with the SAME rootId on the SAME engine collides on the
    // root addObject. The kernel uses std::expected (no exceptions), so the ctor
    // records the error instead of throwing and leaves the construct inert.
    MenuDesigner second(engine, "menu");
    ASSERT_TRUE(second.initError().has_value());

    // A mutating call on the broken construct returns the init error unchanged and
    // performs no work (no section is created).
    auto r = second.addSection("apps", "Appetizers");
    ASSERT_FALSE(r.has_value());
    EXPECT_EQ(r.error(), *second.initError());
    EXPECT_EQ(second.sectionCount(), 0u);
}

TEST(MenuDesigner, MoveItemToUnknownSectionLeavesItemUnchanged) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());

    // Capture the item's original world position before the failed move.
    const auto before = worldCentre(engine, "wings", kItemW, kItemH);
    const auto movedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectMoved);

    // Fail fast: an unknown target rejects BEFORE any engine mutation, so no
    // removeObject happens and the item stays exactly where it was.
    auto r = menu.moveItemToSection("wings", "nope");
    EXPECT_FALSE(r.has_value());

    // Domain data unchanged — still in the old section.
    ASSERT_NE(menu.item("wings"), nullptr);
    EXPECT_EQ(menu.item("wings")->sectionId, "apps");
    EXPECT_EQ(menu.itemCount(), 1u);

    // Scene node unchanged — still hit-testable at its original world position.
    auto hit = engine.hitTest(before);
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "wings");

    // No move cue fired since nothing moved.
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectMoved),
              movedBefore);
}

TEST(MenuDesigner, MoveItemToSameSectionIsNoOpSuccess) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());

    const auto opsBefore = engine.collab().opCount();
    const auto movedBefore =
        engine.synth().triggerCount(audio::SoundEvent::ObjectMoved);

    // Moving to the section it is already in is a no-op success: no scene mutation,
    // no collab op, no audio cue, and the item is untouched.
    ASSERT_TRUE(menu.moveItemToSection("wings", "apps").has_value());
    ASSERT_NE(menu.item("wings"), nullptr);
    EXPECT_EQ(menu.item("wings")->sectionId, "apps");
    EXPECT_EQ(engine.collab().opCount(), opsBefore);
    EXPECT_EQ(engine.synth().triggerCount(audio::SoundEvent::ObjectMoved),
              movedBefore);
}

TEST(MenuDesigner, AddItemToUnknownSectionFails) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    auto r = menu.addItem("nope", "wings", "Wings", 1200);
    EXPECT_FALSE(r.has_value());
    EXPECT_EQ(menu.item("wings"), nullptr);
}

TEST(MenuDesigner, DuplicateIdsFail) {
    AppleUnifiedEngine engine;
    MenuDesigner menu(engine);
    ASSERT_TRUE(menu.addSection("apps", "Appetizers").has_value());
    EXPECT_FALSE(menu.addSection("apps", "Again").has_value());

    ASSERT_TRUE(menu.addItem("apps", "wings", "Wings", 1200).has_value());
    EXPECT_FALSE(menu.addItem("apps", "wings", "Dup", 100).has_value());
}

} // namespace
