#include "ops/pathfinding.hpp"
#include <queue>
#include <cmath>
#include <algorithm>

namespace floorplan::ops {

NavMesh::NavMesh(int width, int height, double cell_size) 
    : width_(width), height_(height), cell_size_(cell_size) {
    grid_.resize(width_ * height_, 0);
}

void NavMesh::addObstacle(const geom::Polygon2D& /*poly*/) {
    // STUB: Rasterize polygon into the grid.
}

[[nodiscard]] std::expected<std::vector<geom::Vertex2D>, std::string> NavMesh::findPath(const geom::Vertex2D& start, const geom::Vertex2D& end) const {
    int startX = static_cast<int>(start.x / cell_size_);
    int startY = static_cast<int>(start.y / cell_size_);
    int endX = static_cast<int>(end.x / cell_size_);
    int endY = static_cast<int>(end.y / cell_size_);

    if (startX < 0 || startX >= width_ || startY < 0 || startY >= height_) return std::unexpected("Start point out of bounds.");
    if (endX < 0 || endX >= width_ || endY < 0 || endY >= height_) return std::unexpected("End point out of bounds.");

    std::vector<geom::Vertex2D> path;
    path.push_back(start);
    path.push_back(end);
    
    return path;
}

} // namespace floorplan::ops
