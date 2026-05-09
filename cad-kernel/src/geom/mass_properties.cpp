#include "geom/mass_properties.hpp"
#include <cmath>

namespace floorplan::geom {

[[nodiscard]] std::expected<MassProperties, std::string> MassEvaluator::compute(const Polygon2D& poly) {
    if (poly.size() < 3) return std::unexpected("Polygon must have at least 3 vertices.");

    double area = 0.0;
    double cx = 0.0;
    double cy = 0.0;
    double ix = 0.0;
    double iy = 0.0;

    size_t n = poly.size();
    for (size_t i = 0; i < n; ++i) {
        const Vertex2D& p1 = poly[i];
        const Vertex2D& p2 = poly[(i + 1) % n];

        double cross = (p1.x * p2.y - p2.x * p1.y);
        area += cross;
        cx += (p1.x + p2.x) * cross;
        cy += (p1.y + p2.y) * cross;
        
        ix += (p1.y * p1.y + p1.y * p2.y + p2.y * p2.y) * cross;
        iy += (p1.x * p1.x + p1.x * p2.x + p2.x * p2.x) * cross;
    }

    area *= 0.5;
    
    if (std::abs(area) < 1e-12) return std::unexpected("Polygon area is zero or degenerate.");

    cx /= (6.0 * area);
    cy /= (6.0 * area);
    ix /= 12.0;
    iy /= 12.0;

    return MassProperties{std::abs(area), {cx, cy}, std::abs(ix), std::abs(iy)};
}

} // namespace floorplan::geom
