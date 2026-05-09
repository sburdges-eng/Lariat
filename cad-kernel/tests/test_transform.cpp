#include <gtest/gtest.h>
#include "geom/transform.hpp"

using namespace floorplan::geom;

TEST(AffineMatrixTest, Identity) {
    AffineMatrix2D identity;
    auto [x, y] = identity.transformPoint(5.0, -3.0);
    EXPECT_DOUBLE_EQ(x, 5.0);
    EXPECT_DOUBLE_EQ(y, -3.0);
}

TEST(AffineMatrixTest, Translation) {
    auto trans = AffineMatrix2D::translation(10.0, 20.0);
    auto [x, y] = trans.transformPoint(0.0, 0.0);
    EXPECT_DOUBLE_EQ(x, 10.0);
    EXPECT_DOUBLE_EQ(y, 20.0);
}

TEST(AffineMatrixTest, Scaling) {
    auto scale = AffineMatrix2D::scaling(2.0, 0.5);
    auto [x, y] = scale.transformPoint(10.0, 10.0);
    EXPECT_DOUBLE_EQ(x, 20.0);
    EXPECT_DOUBLE_EQ(y, 5.0);
}

TEST(AffineMatrixTest, Composition) {
    auto scale = AffineMatrix2D::scaling(2.0, 2.0);
    auto trans = AffineMatrix2D::translation(5.0, 5.0);
    auto comp = scale.multiply(trans);
    auto [x, y] = comp.transformPoint(10.0, 10.0);
    EXPECT_DOUBLE_EQ(x, 30.0);
    EXPECT_DOUBLE_EQ(y, 30.0);
}