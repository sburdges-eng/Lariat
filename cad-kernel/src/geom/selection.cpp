#include "geom/selection.hpp"

namespace floorplan::geom {

[[nodiscard]] static inline double isLeft(const Vertex2D& a, const Vertex2D& b, const Vertex2D& c) {
    return ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
}

[[nodiscard]] std::expected<int, std::string> SelectionEngine::computeWindingNumber(const Vertex2D& pt, const std::vector<Vertex2D>& polygon) {
    if (polygon.size() < 3) return std::unexpected("Polygon must have at least 3 vertices.");

    int wn = 0;
    size_t n = polygon.size();

    for (size_t i = 0; i < n; ++i) {
        const Vertex2D& v1 = polygon[i];
        const Vertex2D& v2 = polygon[(i + 1) % n];

        if (v1.y <= pt.y) {
            if (v2.y > pt.y) {
                if (isLeft(v1, v2, pt) > 0) {
                    ++wn;
                }
            }
        } else {
            if (v2.y <= pt.y) {
                if (isLeft(v1, v2, pt) < 0) {
                    --wn;
                }
            }
        }
    }
    return wn;
}

[[nodiscard]] static std::vector<Vertex2D> getNormals(const std::vector<Vertex2D>& poly) {
    std::vector<Vertex2D> normals;
    size_t n = poly.size();
    for (size_t i = 0; i < n; ++i) {
        Vertex2D p1 = poly[i];
        Vertex2D p2 = poly[(i + 1) % n];
        normals.push_back({-(p2.y - p1.y), p2.x - p1.x});
    }
    return normals;
}

[[nodiscard]] static std::pair<double, double> projectPolygon(const std::vector<Vertex2D>& poly, const Vertex2D& axis) {
    double min_proj = (poly[0].x * axis.x + poly[0].y * axis.y);
    double max_proj = min_proj;

    for (size_t i = 1; i < poly.size(); ++i) {
        double proj = (poly[i].x * axis.x + poly[i].y * axis.y);
        if (proj < min_proj) min_proj = proj;
        if (proj > max_proj) max_proj = proj;
    }
    return {min_proj, max_proj};
}

[[nodiscard]] std::expected<bool, std::string> SelectionEngine::testSATCollision(const std::vector<Vertex2D>& polyA, const std::vector<Vertex2D>& polyB) {
    if (polyA.size() < 3 || polyB.size() < 3) return std::unexpected("Polygons must have at least 3 vertices for SAT.");

    auto checkAxes = [](const std::vector<Vertex2D>& pA, const std::vector<Vertex2D>& pB, const std::vector<Vertex2D>& axes) {
        for (const auto& axis : axes) {
            auto projA = projectPolygon(pA, axis);
            auto projB = projectPolygon(pB, axis);
            if (projA.second < projB.first || projB.second < projA.first) {
                return false;
            }
        }
        return true;
    };

    auto normalsA = getNormals(polyA);
    if (!checkAxes(polyA, polyB, normalsA)) return false;

    auto normalsB = getNormals(polyB);
    if (!checkAxes(polyA, polyB, normalsB)) return false;

    return true;
}

} // namespace floorplan::geom
