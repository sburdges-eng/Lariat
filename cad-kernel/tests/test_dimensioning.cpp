#include <gtest/gtest.h>
#include "geom/dimensioning.hpp"
#include <cmath>

using namespace floorplan::geom;

TEST(DimensioningTest, OrthogonalProjection) {
    Vertex2D pt{5.0, 5.0};
    Vertex2D start{0.0, 0.0};
    Vertex2D end{10.0, 0.0};
    auto res = DimensionEngine::orthogonalProjection(pt, start, end);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value().x, 5.0);
    EXPECT_DOUBLE_EQ(res.value().y, 0.0);
}

TEST(DimensioningTest, AngleBetweenOrthogonal) {
    auto res = DimensionEngine::angleBetween({0,0}, {10,0}, {0,0}, {0,10});
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value(), M_PI / 2.0); // 90 degrees
}
