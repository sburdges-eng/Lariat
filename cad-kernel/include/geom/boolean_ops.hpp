
#pragma once
#include <vector>
#include <expected>
#include <string>

namespace floorplan::geom {

struct Vertex2D {
    double x, y;
};

using Polygon2D = std::vector<Vertex2D>;

class BooleanProcessor {
public:
    [[nodiscard]] static std::expected<Polygon2D, std::string> computeMinkowskiSum(const Polygon2D& base_poly, const Polygon2D& profile);
    [[nodiscard]] static std::expected<std::vector<Polygon2D>, std::string> booleanUnion(const Polygon2D& polyA, const Polygon2D& polyB);
    [[nodiscard]] static std::expected<std::vector<Polygon2D>, std::string> booleanSubtract(const Polygon2D& polyA, const Polygon2D& polyB);
};

} // namespace floorplan::geom
