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

TEST(SceneGraphTest, ParentPointerSetOnAddChild) {
    SceneNode root("root");
    auto child = std::make_unique<SceneNode>("child");
    SceneNode* child_raw = child.get();
    ASSERT_TRUE(root.addChild(std::move(child)).has_value());

    EXPECT_EQ(root.getParent(), nullptr);
    EXPECT_EQ(child_raw->getParent(), &root);
}

TEST(SceneGraphTest, ChildrenIteration) {
    SceneNode root("root");
    ASSERT_TRUE(root.addChild(std::make_unique<SceneNode>("a")).has_value());
    ASSERT_TRUE(root.addChild(std::make_unique<SceneNode>("b")).has_value());

    auto kids = root.children();
    ASSERT_EQ(kids.size(), 2u);
    EXPECT_EQ(kids[0]->getId(), "a");
    EXPECT_EQ(kids[1]->getId(), "b");
}

TEST(SceneGraphTest, RemoveChildDetachesAndClearsParent) {
    SceneNode root("root");
    ASSERT_TRUE(root.addChild(std::make_unique<SceneNode>("a")).has_value());
    ASSERT_TRUE(root.addChild(std::make_unique<SceneNode>("b")).has_value());

    auto removed = root.removeChild("a");
    ASSERT_TRUE(removed.has_value());
    ASSERT_NE(removed->get(), nullptr);
    EXPECT_EQ((*removed)->getId(), "a");
    EXPECT_EQ((*removed)->getParent(), nullptr);

    // Only the sibling remains attached to root.
    auto kids = root.children();
    ASSERT_EQ(kids.size(), 1u);
    EXPECT_EQ(kids[0]->getId(), "b");
}

TEST(SceneGraphTest, RemoveChildUnknownIdFails) {
    SceneNode root("root");
    ASSERT_TRUE(root.addChild(std::make_unique<SceneNode>("a")).has_value());

    auto removed = root.removeChild("missing");
    ASSERT_FALSE(removed.has_value());

    // The existing child is untouched.
    auto kids = root.children();
    ASSERT_EQ(kids.size(), 1u);
    EXPECT_EQ(kids[0]->getId(), "a");
}

TEST(SceneGraphTest, RemoveChildOnlyMatchesDirectChildren) {
    SceneNode root("root");
    auto mid = std::make_unique<SceneNode>("mid");
    SceneNode* mid_raw = mid.get();
    ASSERT_TRUE(root.addChild(std::move(mid)).has_value());
    ASSERT_TRUE(mid_raw->addChild(std::make_unique<SceneNode>("leaf")).has_value());

    // "leaf" is a grandchild, not a direct child of root.
    EXPECT_FALSE(root.removeChild("leaf").has_value());
    EXPECT_EQ(root.children().size(), 1u);

    // It is a direct child of mid.
    EXPECT_TRUE(mid_raw->removeChild("leaf").has_value());
    EXPECT_EQ(mid_raw->children().size(), 0u);
}

TEST(SceneGraphTest, NestedGlobalTransformComposition) {
    // root translated (10,5), child local translation (3,0).
    // child global transformPoint(0,0) must equal (13,5).
    SceneNode root("root");
    root.setLocalTransform(AffineMatrix2D::translation(10.0, 5.0));

    auto child = std::make_unique<SceneNode>("child");
    child->setLocalTransform(AffineMatrix2D::translation(3.0, 0.0));
    SceneNode* child_raw = child.get();
    ASSERT_TRUE(root.addChild(std::move(child)).has_value());

    auto global = child_raw->computeGlobalTransform();
    auto pt = global.transformPoint(0.0, 0.0);
    EXPECT_DOUBLE_EQ(pt.first, 13.0);
    EXPECT_DOUBLE_EQ(pt.second, 5.0);
}

TEST(SceneGraphTest, ThreeLevelGlobalTransformChain) {
    SceneNode root("root");
    root.setLocalTransform(AffineMatrix2D::translation(10.0, 5.0));

    auto mid = std::make_unique<SceneNode>("mid");
    mid->setLocalTransform(AffineMatrix2D::translation(3.0, 0.0));
    SceneNode* mid_raw = mid.get();
    ASSERT_TRUE(root.addChild(std::move(mid)).has_value());

    auto leaf = std::make_unique<SceneNode>("leaf");
    leaf->setLocalTransform(AffineMatrix2D::translation(0.0, 7.0));
    SceneNode* leaf_raw = leaf.get();
    ASSERT_TRUE(mid_raw->addChild(std::move(leaf)).has_value());

    // Accumulated translation: (10+3+0, 5+0+7) = (13, 12).
    auto pt = leaf_raw->computeGlobalTransform().transformPoint(0.0, 0.0);
    EXPECT_DOUBLE_EQ(pt.first, 13.0);
    EXPECT_DOUBLE_EQ(pt.second, 12.0);

    // Mid level stays at (13, 5).
    auto mid_pt = mid_raw->computeGlobalTransform().transformPoint(0.0, 0.0);
    EXPECT_DOUBLE_EQ(mid_pt.first, 13.0);
    EXPECT_DOUBLE_EQ(mid_pt.second, 5.0);
}
