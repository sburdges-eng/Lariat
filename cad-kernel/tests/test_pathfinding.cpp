#include <gtest/gtest.h>
#include "ops/pathfinding.hpp"

using namespace floorplan::ops;
using namespace floorplan::geom;

TEST(PathfindingTest, BasicPath) {
    NavMesh mesh(100, 100, 1.0);
    auto res = mesh.findPath({10.0, 10.0}, {90.0, 90.0});
    ASSERT_TRUE(res.has_value());
    EXPECT_GE(res.value().size(), 2);
}

TEST(PathfindingTest, OutOfBoundsStart) {
    NavMesh mesh(100, 100, 1.0);
    auto res = mesh.findPath({-10.0, 10.0}, {90.0, 90.0});
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Start point out of bounds.");
}
