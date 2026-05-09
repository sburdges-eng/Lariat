
#include <gtest/gtest.h>
#include "solver/newton_raphson.hpp"
#include "solver/jacobian.hpp"
#include "geom/bounding_volume.hpp"
#include "geom/boolean_ops.hpp"

using namespace floorplan::solver;
using namespace floorplan::geom;

TEST(NewtonRaphsonTest, SolvesSuccessfully) {
    ConstraintSystem::ResidualFunc r = [](const ConstraintSystem::VectorXd& x) { return x; };
    ConstraintSystem::JacobianFunc j = [](const ConstraintSystem::VectorXd& /*x*/) { 
        return ConstraintSystem::MatrixXd{{1.0}}; 
    };
    
    ConstraintSystem system(r, j);
    auto result = system.solve({1.0});
    ASSERT_TRUE(result.has_value());
    EXPECT_LT(result.value()[0], 1e-9);
}

TEST(NewtonRaphsonTest, FailsOnNonSquareMatrix) {
    ConstraintSystem::ResidualFunc r = [](const ConstraintSystem::VectorXd& x) { return x; };
    ConstraintSystem::JacobianFunc j = [](const ConstraintSystem::VectorXd& /*x*/) { 
        return ConstraintSystem::MatrixXd{{1.0, 2.0}}; // Non-square
    };
    
    ConstraintSystem system(r, j);
    auto result = system.solve({1.0});
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error(), "Non-square matrix inversion not supported.");
}

TEST(BVHTest, QueriesCorrectly) {
    BVH bvh;
    std::vector<AABB> boxes = {
        {0.0, 0.0, 10.0, 10.0},
        {20.0, 20.0, 30.0, 30.0}
    };
    auto build_res = bvh.build(boxes);
    ASSERT_TRUE(build_res.has_value());

    auto result = bvh.query({5.0, 5.0, 15.0, 15.0});
    ASSERT_EQ(result.size(), 1);
    EXPECT_EQ(result[0], 0);
}

TEST(BVHTest, EmptyBoxesFail) {
    BVH bvh;
    auto build_res = bvh.build({});
    ASSERT_FALSE(build_res.has_value());
    EXPECT_EQ(build_res.error(), "Cannot build BVH with empty boxes.");
}

TEST(BooleanOpsTest, MinkowskiSumEmpty) {
    auto res = BooleanProcessor::computeMinkowskiSum({}, {});
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(res.error(), "Empty polygons provided for Minkowski Sum.");
}
