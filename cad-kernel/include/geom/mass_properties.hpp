#pragma once
#include "geom/boolean_ops.hpp"
#include <expected>
#include <string>

namespace floorplan::geom {

struct MassProperties {
    double area;
    Vertex2D centroid;
    double inertia_x;
    double inertia_y;
};

/**
 * @brief Computes Area, Centroid, and Inertia via Double Integration (Shoelace Formula).
 */
class MassEvaluator {
public:
    [[nodiscard]] static std::expected<MassProperties, std::string> compute(const Polygon2D& poly);
};

} // namespace floorplan::geom
