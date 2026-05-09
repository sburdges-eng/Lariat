#include <gtest/gtest.h>
#include "geom/tin.hpp"

using namespace floorplan::geom;

TEST(TINTest, InsufficientPointsFails) {
    std::vector<GeoPoint3D> points = {{0.0, 0.0, 0.0}, {1.0, 1.0, 0.0}};
    auto res = TINProcessor::generateDelaunay(points);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "TIN generation requires at least 3 points.");
}

TEST(TINTest, BasicTriangulation) {
    std::vector<GeoPoint3D> points = {{0.0, 0.0, 0.0}, {10.0, 0.0, 0.0}, {5.0, 10.0, 5.0}};
    auto res = TINProcessor::generateDelaunay(points);
    ASSERT_TRUE(res.has_value());
    EXPECT_EQ(res.value().size(), 1);
}