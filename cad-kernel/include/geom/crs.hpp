#pragma once
#include "geom/geodesy.hpp"
#include <expected>
#include <string>

namespace floorplan::geom {

/**
 * @brief Parameters for a Helmert 7-parameter datum transformation.
 * Used for shifting coordinates between different Geodetic Datums.
 */
struct HelmertParams {
    double tx, ty, tz;       // Translation (meters)
    double rx, ry, rz;       // Rotation (arc-seconds)
    double scale_ppm;        // Scale difference (parts per million)
};

/**
 * @brief Coordinate Reference System (CRS) projection engine.
 */
class CRSEngine {
public:
    /**
     * @brief Performs a 7-parameter Helmert Transformation to shift datums.
     * Enforces strict 64-bit precision to avoid geospatial truncation.
     */
    [[nodiscard]] static std::expected<GeoPoint3D, std::string> transformDatum(const GeoPoint3D& pt, const HelmertParams& params);
};

} // namespace floorplan::geom
