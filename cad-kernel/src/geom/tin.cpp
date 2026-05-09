#include "geom/tin.hpp"

namespace floorplan::geom {

[[nodiscard]] std::expected<std::vector<Triangle3D>, std::string> TINProcessor::generateDelaunay(const std::vector<GeoPoint3D>& points) {
    if (points.size() < 3) {
        return std::unexpected("TIN generation requires at least 3 points.");
    }
    
    // Stub implementation: Returns a single triangle for the first 3 points
    // A robust Bowyer-Watson or Divide-and-Conquer algorithm goes here
    std::vector<Triangle3D> result;
    result.push_back({points[0], points[1], points[2]});
    return result;
}

} // namespace floorplan::geom