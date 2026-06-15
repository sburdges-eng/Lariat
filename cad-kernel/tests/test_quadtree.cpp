#include <gtest/gtest.h>
#include <algorithm>
#include "geom/quadtree.hpp"

using namespace floorplan::geom;

namespace {

bool contains_id(const std::vector<uint32_t>& v, uint32_t id) {
    return std::find(v.begin(), v.end(), id) != v.end();
}

AABB worldBounds() { return AABB{0.0, 0.0, 100.0, 100.0}; }

} // namespace

TEST(QuadtreeTest, InsertAndSize) {
    Quadtree qt(worldBounds());
    EXPECT_EQ(qt.size(), 0u);
    ASSERT_TRUE(qt.insert(1, AABB{1.0, 1.0, 2.0, 2.0}).has_value());
    ASSERT_TRUE(qt.insert(2, AABB{10.0, 10.0, 12.0, 12.0}).has_value());
    EXPECT_EQ(qt.size(), 2u);
}

TEST(QuadtreeTest, InsertOutsideWorldFails) {
    Quadtree qt(worldBounds());
    auto res = qt.insert(99, AABB{200.0, 200.0, 210.0, 210.0});
    ASSERT_FALSE(res.has_value());
    EXPECT_EQ(qt.size(), 0u);
}

TEST(QuadtreeTest, QueryPointHitsAndMisses) {
    Quadtree qt(worldBounds());
    ASSERT_TRUE(qt.insert(1, AABB{0.0, 0.0, 5.0, 5.0}).has_value());
    ASSERT_TRUE(qt.insert(2, AABB{50.0, 50.0, 60.0, 60.0}).has_value());
    ASSERT_TRUE(qt.insert(3, AABB{90.0, 90.0, 95.0, 95.0}).has_value());

    auto hit1 = qt.queryPoint(Vertex2D{2.5, 2.5});
    EXPECT_TRUE(contains_id(hit1, 1));
    EXPECT_FALSE(contains_id(hit1, 2));
    EXPECT_FALSE(contains_id(hit1, 3));

    auto hit2 = qt.queryPoint(Vertex2D{55.0, 55.0});
    EXPECT_TRUE(contains_id(hit2, 2));
    EXPECT_FALSE(contains_id(hit2, 1));

    auto miss = qt.queryPoint(Vertex2D{30.0, 30.0});
    EXPECT_TRUE(miss.empty());
}

TEST(QuadtreeTest, QueryRangeReturnsIntersecting) {
    Quadtree qt(worldBounds());
    ASSERT_TRUE(qt.insert(1, AABB{0.0, 0.0, 10.0, 10.0}).has_value());
    ASSERT_TRUE(qt.insert(2, AABB{20.0, 20.0, 30.0, 30.0}).has_value());
    ASSERT_TRUE(qt.insert(3, AABB{80.0, 80.0, 90.0, 90.0}).has_value());

    auto hits = qt.queryRange(AABB{5.0, 5.0, 25.0, 25.0});
    EXPECT_TRUE(contains_id(hits, 1));
    EXPECT_TRUE(contains_id(hits, 2));
    EXPECT_FALSE(contains_id(hits, 3));
}

TEST(QuadtreeTest, RemoveWorks) {
    Quadtree qt(worldBounds());
    ASSERT_TRUE(qt.insert(1, AABB{0.0, 0.0, 5.0, 5.0}).has_value());
    ASSERT_TRUE(qt.insert(2, AABB{50.0, 50.0, 60.0, 60.0}).has_value());
    EXPECT_EQ(qt.size(), 2u);

    EXPECT_TRUE(qt.remove(1));
    EXPECT_EQ(qt.size(), 1u);
    EXPECT_TRUE(qt.queryPoint(Vertex2D{2.5, 2.5}).empty());

    // Removing a non-existent id is a no-op.
    EXPECT_FALSE(qt.remove(1));
    EXPECT_FALSE(qt.remove(999));
    EXPECT_EQ(qt.size(), 1u);
}

TEST(QuadtreeTest, UpdateRelocatesId) {
    Quadtree qt(worldBounds());
    ASSERT_TRUE(qt.insert(1, AABB{0.0, 0.0, 5.0, 5.0}).has_value());
    EXPECT_TRUE(contains_id(qt.queryPoint(Vertex2D{2.5, 2.5}), 1));

    ASSERT_TRUE(qt.update(1, AABB{70.0, 70.0, 75.0, 75.0}).has_value());
    EXPECT_EQ(qt.size(), 1u);

    // Old location no longer hits.
    EXPECT_FALSE(contains_id(qt.queryPoint(Vertex2D{2.5, 2.5}), 1));
    // New location does.
    EXPECT_TRUE(contains_id(qt.queryPoint(Vertex2D{72.0, 72.0}), 1));
}

TEST(QuadtreeTest, UpdateOutsideWorldFails) {
    Quadtree qt(worldBounds());
    ASSERT_TRUE(qt.insert(1, AABB{0.0, 0.0, 5.0, 5.0}).has_value());
    auto res = qt.update(1, AABB{500.0, 500.0, 510.0, 510.0});
    ASSERT_FALSE(res.has_value());
}

TEST(QuadtreeTest, SubdivisionWithManyEntries) {
    // Force subdivision by inserting more than capacity entries, then verify
    // queries still return correct results.
    Quadtree qt(worldBounds(), /*capacity=*/4, /*max_depth=*/8);
    for (uint32_t i = 0; i < 40; ++i) {
        const double x = static_cast<double>(i) * 2.0;  // 0..78, inside world
        ASSERT_TRUE(qt.insert(i, AABB{x, x, x + 1.0, x + 1.0}).has_value());
    }
    EXPECT_EQ(qt.size(), 40u);

    // Entry 10 occupies [20,21]x[20,21]; its center is (20.5, 20.5).
    auto hit = qt.queryPoint(Vertex2D{20.5, 20.5});
    EXPECT_TRUE(contains_id(hit, 10));

    auto range = qt.queryRange(AABB{0.0, 0.0, 5.0, 5.0});
    EXPECT_TRUE(contains_id(range, 0));
    EXPECT_TRUE(contains_id(range, 1));
    EXPECT_TRUE(contains_id(range, 2));
    EXPECT_FALSE(contains_id(range, 39));
}

TEST(QuadtreeTest, StraddlingEntryFoundAfterSubdivision) {
    // An entry crossing the world midline (50,50) cannot fit any quadrant and
    // must remain queryable at the root after subdivision is triggered.
    Quadtree qt(worldBounds(), /*capacity=*/2, /*max_depth=*/8);
    ASSERT_TRUE(qt.insert(100, AABB{40.0, 40.0, 60.0, 60.0}).has_value());  // straddles center
    for (uint32_t i = 0; i < 10; ++i) {
        ASSERT_TRUE(qt.insert(i, AABB{1.0, 1.0, 2.0, 2.0}).has_value());
    }
    EXPECT_TRUE(contains_id(qt.queryPoint(Vertex2D{50.0, 50.0}), 100));
    EXPECT_TRUE(contains_id(qt.queryRange(AABB{55.0, 55.0, 58.0, 58.0}), 100));
}
