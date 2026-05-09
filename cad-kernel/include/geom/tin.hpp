#pragma once
#include "geom/geodesy.hpp"
#include <vector>
#include <expected>
#include <string>

namespace floorplan::geom {

struct Triangle3D {
    GeoPoint3D v1, v2, v3;
};

/**
 * @brief Triangulated Irregular Network (TIN) processor.
 * Generates Constrained Delaunay Triangulations for Digital Elevation Models (DEM).
 */
class TINProcessor {
public:
    /**
     * @brief Generates a standard Delaunay triangulation from a set of 3D geodetic points.
     */
    [[nodiscard]] static std::expected<std::vector<Triangle3D>, std::string> generateDelaunay(const std::vector<GeoPoint3D>& points);
};

} // namespace floorplan::geom