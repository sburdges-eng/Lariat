#include "geom/dimensioning.hpp"
#include <cmath>

namespace floorplan::geom {

[[nodiscard]] std::expected<Vertex2D, std::string> DimensionEngine::orthogonalProjection(const Vertex2D& pt, const Vertex2D& lineStart, const Vertex2D& lineEnd) {
    double l2 = std::pow(lineEnd.x - lineStart.x, 2) + std::pow(lineEnd.y - lineStart.y, 2);
    if (l2 == 0.0) return std::unexpected("Line segment length is zero.");

    double t = ((pt.x - lineStart.x) * (lineEnd.x - lineStart.x) + (pt.y - lineStart.y) * (lineEnd.y - lineStart.y)) / l2;
    return Vertex2D{lineStart.x + t * (lineEnd.x - lineStart.x), lineStart.y + t * (lineEnd.y - lineStart.y)};
}

[[nodiscard]] std::expected<double, std::string> DimensionEngine::angleBetween(const Vertex2D& v1_start, const Vertex2D& v1_end, const Vertex2D& v2_start, const Vertex2D& v2_end) {
    double u_x = v1_end.x - v1_start.x;
    double u_y = v1_end.y - v1_start.y;
    double v_x = v2_end.x - v2_start.x;
    double v_y = v2_end.y - v2_start.y;

    double dot = u_x * v_x + u_y * v_y;
    double mag_u = std::sqrt(u_x * u_x + u_y * u_y);
    double mag_v = std::sqrt(v_x * v_x + v_y * v_y);

    if (mag_u == 0.0 || mag_v == 0.0) return std::unexpected("Zero magnitude vector.");

    double cos_theta = dot / (mag_u * mag_v);
    cos_theta = std::fmax(-1.0, std::fmin(1.0, cos_theta)); // Clamp to avoid floating point errors

    return std::acos(cos_theta);
}

} // namespace floorplan::geom
