#include <gtest/gtest.h>
#include "geom/octree.hpp"

using namespace floorplan::geom;

TEST(OctreeTest, PointInsertion) {
    PointCloudOctree octree;
    auto res = octree.insertPoint({100.0, 200.0, 300.0});
    ASSERT_TRUE(res.has_value());
    EXPECT_EQ(octree.getPointCount(), 1);
}