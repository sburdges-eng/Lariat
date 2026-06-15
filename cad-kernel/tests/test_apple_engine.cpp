#include <gtest/gtest.h>

#include "apple/graphics/engine.hpp"
#include "apple/graphics/render_backend.hpp"
#include "apple/graphics/scene_object.hpp"
#include "apple/graphics/types.hpp"

namespace {

using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::NullRenderBackend;
using AppleGraphics::ObjectType;
namespace geom = floorplan::geom;

// A unit box centred at the local origin.
constexpr geom::AABB kUnitBox{-1.0, -1.0, 1.0, 1.0};

geom::AffineMatrix2D identity() { return geom::AffineMatrix2D{}; }

TEST(AppleEngine, AddObjectRegistersInStoreAndQuadtree) {
    AppleUnifiedEngine engine;
    EXPECT_EQ(engine.store().size(), 0u);
    EXPECT_EQ(engine.quadtree().size(), 0u);

    auto r = engine.addObject("root", "a", ObjectType::Table, identity(), kUnitBox, 0);
    ASSERT_TRUE(r.has_value());

    EXPECT_EQ(engine.store().size(), 1u);
    EXPECT_EQ(engine.quadtree().size(), 1u);
    ASSERT_NE(engine.store().find("a"), nullptr);
    EXPECT_EQ(engine.typeOf("a"), ObjectType::Table);
}

TEST(AppleEngine, HitTestFindsObjectContainingPoint) {
    AppleUnifiedEngine engine;
    ASSERT_TRUE(engine.addObject("root", "a", ObjectType::Table,
                                 geom::AffineMatrix2D::translation(10, 10),
                                 kUnitBox, 0)
                    .has_value());

    EXPECT_EQ(engine.hitTest(geom::Vertex2D{10.0, 10.0}), std::optional<std::string>{"a"});
    EXPECT_FALSE(engine.hitTest(geom::Vertex2D{100.0, 100.0}).has_value());
}

TEST(AppleEngine, HitTestPicksHigherZOrderOnOverlap) {
    AppleUnifiedEngine engine;
    ASSERT_TRUE(engine.addObject("root", "low", ObjectType::Table, identity(), kUnitBox, 1)
                    .has_value());
    ASSERT_TRUE(engine.addObject("root", "high", ObjectType::MenuItem, identity(), kUnitBox, 5)
                    .has_value());

    EXPECT_EQ(engine.hitTest(geom::Vertex2D{0.0, 0.0}), std::optional<std::string>{"high"});
}

TEST(AppleEngine, NestedTransformUsesGlobalTransformForWorldAABB) {
    AppleUnifiedEngine engine;
    // Parent translated to (100, 0); child at local origin with unit bounds.
    ASSERT_TRUE(engine.addObject("root", "parent", ObjectType::MenuSection,
                                 geom::AffineMatrix2D::translation(100, 0),
                                 kUnitBox, 0)
                    .has_value());
    ASSERT_TRUE(engine.addObject("parent", "child", ObjectType::MenuItem,
                                 identity(), kUnitBox, 1)
                    .has_value());

    // The child lives at world (100, 0) because of the parent's transform.
    auto hit = engine.hitTest(geom::Vertex2D{100.0, 0.0});
    ASSERT_TRUE(hit.has_value());
    EXPECT_EQ(*hit, "child"); // higher zOrder than parent at the same point
    // Local origin (0,0) should miss both (parent is at world 100,0).
    EXPECT_FALSE(engine.hitTest(geom::Vertex2D{0.0, 0.0}).has_value());
}

TEST(AppleEngine, MoveObjectRelocatesInQuadtree) {
    AppleUnifiedEngine engine;
    ASSERT_TRUE(engine.addObject("root", "a", ObjectType::Table, identity(), kUnitBox, 0)
                    .has_value());

    EXPECT_EQ(engine.hitTest(geom::Vertex2D{0.0, 0.0}), std::optional<std::string>{"a"});

    ASSERT_TRUE(engine.moveObject("a", geom::AffineMatrix2D::translation(50, 50))
                    .has_value());

    EXPECT_FALSE(engine.hitTest(geom::Vertex2D{0.0, 0.0}).has_value());
    EXPECT_EQ(engine.hitTest(geom::Vertex2D{50.0, 50.0}), std::optional<std::string>{"a"});
}

TEST(AppleEngine, MovingParentMovesChildInQuadtree) {
    AppleUnifiedEngine engine;
    ASSERT_TRUE(engine.addObject("root", "parent", ObjectType::MenuSection,
                                 identity(), kUnitBox, 0)
                    .has_value());
    ASSERT_TRUE(engine.addObject("parent", "child", ObjectType::MenuItem,
                                 identity(), kUnitBox, 1)
                    .has_value());

    // Child initially at world origin.
    EXPECT_EQ(engine.hitTest(geom::Vertex2D{0.0, 0.0}), std::optional<std::string>{"child"});

    ASSERT_TRUE(engine.moveObject("parent", geom::AffineMatrix2D::translation(200, 0))
                    .has_value());

    EXPECT_FALSE(engine.hitTest(geom::Vertex2D{0.0, 0.0}).has_value());
    EXPECT_EQ(engine.hitTest(geom::Vertex2D{200.0, 0.0}), std::optional<std::string>{"child"});
}

TEST(AppleEngine, RemoveObjectRemovesSubtree) {
    AppleUnifiedEngine engine;
    ASSERT_TRUE(engine.addObject("root", "parent", ObjectType::MenuSection,
                                 identity(), kUnitBox, 0)
                    .has_value());
    ASSERT_TRUE(engine.addObject("parent", "child", ObjectType::MenuItem,
                                 identity(), kUnitBox, 1)
                    .has_value());
    EXPECT_EQ(engine.store().size(), 2u);
    ASSERT_EQ(engine.root().children().size(), 1u);

    EXPECT_TRUE(engine.removeObject("parent"));

    EXPECT_EQ(engine.store().size(), 0u);
    EXPECT_EQ(engine.quadtree().size(), 0u);
    EXPECT_FALSE(engine.hitTest(geom::Vertex2D{0.0, 0.0}).has_value());
    EXPECT_EQ(engine.store().find("child"), nullptr);

    // The node must also be detached from the scene graph, not just purged
    // from the engine index: root must no longer own "parent" (or any child),
    // so renderFrame won't walk the orphaned subtree.
    EXPECT_EQ(engine.root().children().size(), 0u);
    for (const auto& kid : engine.root().children()) {
        EXPECT_NE(kid->getId(), "parent");
    }
}

TEST(AppleEngine, RemoveRootDisallowed) {
    AppleUnifiedEngine engine;
    EXPECT_FALSE(engine.removeObject("root"));
}

TEST(AppleEngine, UpdateIncrementsFrameCount) {
    auto backend = std::make_unique<NullRenderBackend>();
    NullRenderBackend* backendPtr = backend.get();
    AppleUnifiedEngine engine(geom::AABB{-1e4, -1e4, 1e4, 1e4}, std::move(backend));

    EXPECT_EQ(backendPtr->frameCount(), 0u);
    engine.update();
    engine.update();
    EXPECT_EQ(backendPtr->frameCount(), 2u);
    EXPECT_EQ(engine.renderer().frameCount(), 2u);
}

TEST(AppleEngine, AddObjectMissingParentFails) {
    AppleUnifiedEngine engine;
    auto r = engine.addObject("nope", "a", ObjectType::Table, identity(), kUnitBox, 0);
    EXPECT_FALSE(r.has_value());
}

TEST(AppleEngine, AddObjectDuplicateIdFails) {
    AppleUnifiedEngine engine;
    ASSERT_TRUE(engine.addObject("root", "a", ObjectType::Table, identity(), kUnitBox, 0)
                    .has_value());
    auto r = engine.addObject("root", "a", ObjectType::Table, identity(), kUnitBox, 0);
    EXPECT_FALSE(r.has_value());
}

} // namespace
