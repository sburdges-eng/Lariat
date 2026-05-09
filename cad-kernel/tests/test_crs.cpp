#include <gtest/gtest.h>
#include "geom/crs.hpp"

using namespace floorplan::geom;

TEST(CRSEngineTest, IdentityHelmert) {
    GeoPoint3D pt{1000.0, 2000.0, 50.0};
    HelmertParams identity{0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
    
    auto res = CRSEngine::transformDatum(pt, identity);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value().x, 1000.0);
    EXPECT_DOUBLE_EQ(res.value().y, 2000.0);
    EXPECT_DOUBLE_EQ(res.value().z, 50.0);
}

TEST(CRSEngineTest, TranslationHelmert) {
    GeoPoint3D pt{1000.0, 2000.0, 50.0};
    HelmertParams params{10.0, -5.0, 2.0, 0.0, 0.0, 0.0, 0.0};
    
    auto res = CRSEngine::transformDatum(pt, params);
    ASSERT_TRUE(res.has_value());
    EXPECT_DOUBLE_EQ(res.value().x, 1010.0);
    EXPECT_DOUBLE_EQ(res.value().y, 1995.0);
    EXPECT_DOUBLE_EQ(res.value().z, 52.0);
}

TEST(CRSEngineTest, ScaleHelmert) {
    GeoPoint3D pt{1000.0, 2000.0, 50.0};
    // 100 ppm = 0.0001 scale factor
    HelmertParams params{0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 100.0}; 
    
    auto res = CRSEngine::transformDatum(pt, params);
    ASSERT_TRUE(res.has_value());
    // X: 1000 + 1000 * 0.0001 = 1000.1
    EXPECT_DOUBLE_EQ(res.value().x, 1000.1);
    EXPECT_DOUBLE_EQ(res.value().y, 2000.2);
    EXPECT_DOUBLE_EQ(res.value().z, 50.005);
}
