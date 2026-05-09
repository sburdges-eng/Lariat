
#include "geom/boolean_ops.hpp"

namespace floorplan::geom {

[[nodiscard]] std::expected<Polygon2D, std::string> BooleanProcessor::computeMinkowskiSum(const Polygon2D& base_poly, const Polygon2D& profile) {
    if (base_poly.empty() || profile.empty()) return std::unexpected("Empty polygons provided for Minkowski Sum.");
    Polygon2D result;
    for (const auto& v1 : base_poly) {
        for (const auto& v2 : profile) {
            result.push_back({v1.x + v2.x, v1.y + v2.y});
        }
    }
    return result;
}

[[nodiscard]] std::expected<std::vector<Polygon2D>, std::string> BooleanProcessor::booleanUnion(const Polygon2D& polyA, const Polygon2D& /*polyB*/) {
    if (polyA.empty()) return std::unexpected("polyA is empty.");
    std::vector<Polygon2D> result;
    result.push_back(polyA);
    return result;
}

[[nodiscard]] std::expected<std::vector<Polygon2D>, std::string> BooleanProcessor::booleanSubtract(const Polygon2D& polyA, const Polygon2D& /*polyB*/) {
    if (polyA.empty()) return std::unexpected("polyA is empty.");
    std::vector<Polygon2D> result;
    result.push_back(polyA);
    return result;
}

} // namespace floorplan::geom
