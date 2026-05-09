#pragma once
#include <vector>
#include <expected>
#include <string>
#include "geom/boolean_ops.hpp"

namespace floorplan::geom {

/**
 * @brief Selection Engine utilizing Mathematical Topology Constraints.
 */
class SelectionEngine {
public:
    /**
     * @brief Point-in-Polygon (Winding Number Algorithm) for Lasso Selections.
     * @return Positive winding number if inside, 0 if outside.
     */
    [[nodiscard]] static std::expected<int, std::string> computeWindingNumber(const Vertex2D& pt, const std::vector<Vertex2D>& polygon);

    /**
     * @brief Separating Axis Theorem (SAT) for Crossing Selection (Convex Polygons).
     * @return true if polygons intersect.
     */
    [[nodiscard]] static std::expected<bool, std::string> testSATCollision(const std::vector<Vertex2D>& polyA, const std::vector<Vertex2D>& polyB);
};

} // namespace floorplan::geom
