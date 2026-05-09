#pragma once
#include "geom/geodesy.hpp"
#include <vector>
#include <expected>
#include <string>
#include <memory>

namespace floorplan::geom {

/**
 * @brief Out-of-core Octree data structure for LiDAR Point Cloud Ingestion.
 * Uses contiguous memory allocation principles.
 */
class PointCloudOctree {
public:
    constexpr PointCloudOctree() = default;

    [[nodiscard]] std::expected<void, std::string> insertPoint(const GeoPoint3D& point);
    [[nodiscard]] size_t getPointCount() const { return points_.size(); }

private:
    // SoA or contiguous vector approach for cache locality
    std::vector<GeoPoint3D> points_;
};

} // namespace floorplan::geom