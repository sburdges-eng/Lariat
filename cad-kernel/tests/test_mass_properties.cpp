#include <gtest/gtest.h>
#include "geom/mass_properties.hpp"

using namespace floorplan::geom;

TEST(MassPropertiesTest, RectAreaAndCentroid) {
    Polygon2D poly = {{0,0}, {10,0}, {10,10}, {0,10}};
    auto res = MassEvaluator::compute(poly);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value().area, 100.0);
    EXPECT_DOUBLE_EQ(res.value().centroid.x, 5.0);
    EXPECT_DOUBLE_EQ(res.value().centroid.y, 5.0);
}

TEST(MassPropertiesTest, InvalidPolygon) {
    Polygon2D poly = {{0,0}, {10,0}};
    auto res = MassEvaluator::compute(poly);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Polygon must have at least 3 vertices.");
}
