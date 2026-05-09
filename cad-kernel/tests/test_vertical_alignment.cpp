#include <gtest/gtest.h>
#include "geom/vertical_alignment.hpp"

using namespace floorplan::geom;

TEST(VerticalParabolaTest, MidpointElevation) {
    VerticalParabola curve(1000.0, 50.0, 0.02, -0.02, 400.0);
    auto res = curve.elevationAt(1200.0);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value(), 52.0);
}

TEST(VerticalParabolaTest, OutOfBoundsFails) {
    VerticalParabola curve(1000.0, 50.0, 0.02, -0.02, 400.0);
    auto res = curve.elevationAt(900.0);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Station is outside the bounds of the vertical curve.");
}

TEST(VerticalParabolaTest, ZeroLengthFails) {
    VerticalParabola curve(1000.0, 50.0, 0.02, -0.02, 0.0);
    auto res = curve.elevationAt(1000.0);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Curve length must be strictly positive.");
}
