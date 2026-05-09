#pragma once
#include "geom/boolean_ops.hpp"
#include <expected>
#include <string>

namespace floorplan::geom {

/**
 * @brief Dimensioning & Annotation Mathematics.
 */
class DimensionEngine {
public:
    /**
     * @brief Computes the orthogonal projection of a point onto a line segment.
     */
    [[nodiscard]] static std::expected<Vertex2D, std::string> orthogonalProjection(const Vertex2D& pt, const Vertex2D& lineStart, const Vertex2D& lineEnd);

    /**
     * @brief Computes the angle between two vectors using the Dot Product.
     * @return Angle in radians.
     */
    [[nodiscard]] static std::expected<double, std::string> angleBetween(const Vertex2D& v1_start, const Vertex2D& v1_end, const Vertex2D& v2_start, const Vertex2D& v2_end);
};

} // namespace floorplan::geom
