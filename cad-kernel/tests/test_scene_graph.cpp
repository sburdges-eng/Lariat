#include <gtest/gtest.h>
#include "core/scene_graph.hpp"

using namespace floorplan::core;
using namespace floorplan::geom;

TEST(SceneGraphTest, NodeCreationAndTransform) {
    SceneNode node("root");
    EXPECT_EQ(node.getId(), "root");
    
    AffineMatrix2D trans = AffineMatrix2D::translation(10.0, 5.0);
    node.setLocalTransform(trans);
    
    auto global = node.computeGlobalTransform();
    auto pt = global.transformPoint(0, 0);
    EXPECT_DOUBLE_EQ(pt.first, 10.0);
    EXPECT_DOUBLE_EQ(pt.second, 5.0);
}

TEST(SceneGraphTest, AddChild) {
    SceneNode root("root");
    auto child = std::make_unique<SceneNode>("child1");
    auto res = root.addChild(std::move(child));
    ASSERT_TRUE(res.has_value());
}

TEST(SceneGraphTest, AddNullChildFails) {
    SceneNode root("root");
    auto res = root.addChild(nullptr);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Cannot add a null child to SceneNode.");
}
