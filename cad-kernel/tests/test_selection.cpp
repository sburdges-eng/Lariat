#include <gtest/gtest.h>
#include "geom/selection.hpp"

using namespace floorplan::geom;

TEST(SelectionEngineTest, WindingNumberInside) {
    std::vector<Vertex2D> poly = {{0,0}, {10,0}, {10,10}, {0,10}};
    Vertex2D pt = {5, 5};
    auto res = SelectionEngine::computeWindingNumber(pt, poly);
    ASSERT_TRUE(res.has_value());
    EXPECT_NE(res.value(), 0);
}

TEST(SelectionEngineTest, WindingNumberOutside) {
    std::vector<Vertex2D> poly = {{0,0}, {10,0}, {10,10}, {0,10}};
    Vertex2D pt = {15, 15};
    auto res = SelectionEngine::computeWindingNumber(pt, poly);
    ASSERT_TRUE(res.has_value());
    EXPECT_EQ(res.value(), 0);
}

TEST(SelectionEngineTest, SATCollisionIntersect) {
    std::vector<Vertex2D> polyA = {{0,0}, {10,0}, {10,10}, {0,10}};
    std::vector<Vertex2D> polyB = {{5,5}, {15,5}, {15,15}, {5,15}};
    auto res = SelectionEngine::testSATCollision(polyA, polyB);
    ASSERT_TRUE(res.has_value());
    EXPECT_TRUE(res.value());
}

TEST(SelectionEngineTest, SATCollisionSeparate) {
    std::vector<Vertex2D> polyA = {{0,0}, {10,0}, {10,10}, {0,10}};
    std::vector<Vertex2D> polyB = {{20,20}, {30,20}, {30,30}, {20,30}};
    auto res = SelectionEngine::testSATCollision(polyA, polyB);
    ASSERT_TRUE(res.has_value());
    EXPECT_FALSE(res.value());
}
