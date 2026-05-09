#include "geom/octree.hpp"

namespace floorplan::geom {

[[nodiscard]] std::expected<void, std::string> PointCloudOctree::insertPoint(const GeoPoint3D& point) {
    // Stub implementation: Just add to contiguous array
    points_.push_back(point);
    return {};
}

} // namespace floorplan::geom