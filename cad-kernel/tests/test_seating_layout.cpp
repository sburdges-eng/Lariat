#include <gtest/gtest.h>
#include "ops/seating_layout.hpp"

using namespace floorplan::ops;
using namespace floorplan::geom;

TEST(SeatingOptimizerTest, BasicLayout) {
    Polygon2D boundary = {{0,0}, {100,0}, {100,100}, {0,100}};
    auto res = SeatingOptimizer::generateLayout(boundary, 3.0); 
    ASSERT_TRUE(res.has_value());
    EXPECT_GT(res.value().size(), 0);
}

TEST(SeatingOptimizerTest, InvalidBoundary) {
    Polygon2D boundary = {{0,0}, {100,0}}; 
    auto res = SeatingOptimizer::generateLayout(boundary, 3.0);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Invalid boundary polygon.");
}
