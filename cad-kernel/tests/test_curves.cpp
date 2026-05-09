#include <gtest/gtest.h>
#include "geom/curves.hpp"

using namespace floorplan::geom;

TEST(BezierTest, EvaluatesLine) {
    BezierCurve curve({{0.0, 0.0}, {10.0, 10.0}});
    auto res = curve.evaluateAt(0.5);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value().first, 5.0);
    EXPECT_DOUBLE_EQ(res.value().second, 5.0);
}

TEST(BezierTest, EmptyControlPointsFail) {
    BezierCurve curve({});
    auto res = curve.evaluateAt(0.5);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Cannot evaluate Bezier curve with zero control points.");
}

TEST(BezierTest, OutOfBoundsParameterFail) {
    BezierCurve curve({{0.0, 0.0}, {10.0, 10.0}});
    auto res = curve.evaluateAt(1.5);
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Parameter t must be between 0.0 and 1.0 inclusive.");
}

TEST(BezierTest, QuadraticCurve) {
    BezierCurve curve({{0.0, 0.0}, {5.0, 10.0}, {10.0, 0.0}});
    auto res = curve.evaluateAt(0.5);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value().first, 5.0);
    EXPECT_DOUBLE_EQ(res.value().second, 5.0);
}