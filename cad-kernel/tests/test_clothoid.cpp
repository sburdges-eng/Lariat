#include <gtest/gtest.h>
#include "geom/clothoid.hpp"
#include <cmath>

using namespace floorplan::geom;

TEST(ClothoidTest, EvaluateAtZeroLength) {
    ClothoidSpiral spiral(10.0, 20.0, 0.0, 0.0, 0.01);
    auto res = spiral.evaluateAtLength(0.0);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value().first, 10.0);
    EXPECT_DOUBLE_EQ(res.value().second, 20.0);
}

TEST(ClothoidTest, NegativeLengthFails) {
    ClothoidSpiral spiral(0.0, 0.0, 0.0, 0.0, 0.01);
    auto res = spiral.evaluateAtLength(-5.0);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Arc length s must be non-negative.");
}

TEST(ClothoidTest, StraightLineApproximation) {
    // If curvature rate is 0 and kappa is 0, it should be a straight line
    ClothoidSpiral spiral(0.0, 0.0, 0.0, 0.0, 0.0);
    auto res = spiral.evaluateAtLength(10.0);
    ASSERT_TRUE(res.has_value());
    // cos(0) = 1, sin(0) = 0
    EXPECT_NEAR(res.value().first, 10.0, 1e-6);
    EXPECT_NEAR(res.value().second, 0.0, 1e-6);
}