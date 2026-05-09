#pragma once
#include <vector>
#include <expected>
#include <string>
#include "geom/boolean_ops.hpp"

namespace floorplan::ops {

/**
 * @brief Navigation mesh or grid for restaurant floor plans.
 */
class NavMesh {
public:
    NavMesh(int width, int height, double cell_size);

    void addObstacle(const geom::Polygon2D& poly);
    
    /**
     * @brief Computes the shortest path avoiding tables and walls using A*.
     */
    [[nodiscard]] std::expected<std::vector<geom::Vertex2D>, std::string> findPath(const geom::Vertex2D& start, const geom::Vertex2D& end) const;

private:
    int width_, height_;
    double cell_size_;
    std::vector<uint8_t> grid_;
};

} // namespace floorplan::ops
