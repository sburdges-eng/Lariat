#include <gtest/gtest.h>
#include "geom/geodesy.hpp"

using namespace floorplan::geom;

TEST(GeodesyTest, DistanceCalculation) {
    GeoPoint3D p1{0.0, 0.0, 0.0};
    GeoPoint3D p2{3.0, 4.0, 0.0};
    EXPECT_DOUBLE_EQ(p1.distanceTo(p2), 5.0);
}

TEST(GeodesyTest, GridToGroundScaling) {
    SpatialTransformer transformer(1000.0, 1000.0, 1.0001);
    GeoPoint3D grid_pt{2000.0, 1000.0, 50.0};
    GeoPoint3D ground_pt = transformer.gridToGround(grid_pt);
    
    // Distance from origin: 1000. Scaled: 1000 * 1.0001 = 1000.1
    // Ground X: 1000 + 1000.1 = 2000.1
    EXPECT_DOUBLE_EQ(ground_pt.x, 2000.1);
    EXPECT_DOUBLE_EQ(ground_pt.y, 1000.0);
    EXPECT_DOUBLE_EQ(ground_pt.z, 50.0);
}