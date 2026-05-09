#pragma once
#include <expected>
#include <string>
#include <cmath>

namespace floorplan::geom {

/**
 * @brief 64-bit Geodetic Coordinate Point.
 * Represents a point in a global coordinate system (e.g., State Plane, UTM).
 * Enforces strict double precision to prevent catastrophic cancellation.
 */
struct GeoPoint3D {
    double x; // Easting
    double y; // Northing
    double z; // Elevation

    [[nodiscard]] constexpr double distanceTo(const GeoPoint3D& other) const {
        return std::sqrt((other.x - x) * (other.x - x) +
                         (other.y - y) * (other.y - y) +
                         (other.z - z) * (other.z - z));
    }
};

/**
 * @brief Handles affine spatial transformations (Grid-to-Ground scaling).
 */
class SpatialTransformer {
public:
    constexpr SpatialTransformer(double origin_x, double origin_y, double scale_factor)
        : origin_x_(origin_x), origin_y_(origin_y), scale_factor_(scale_factor) {}

    [[nodiscard]] constexpr GeoPoint3D gridToGround(const GeoPoint3D& grid_pt) const {
        return {
            origin_x_ + (grid_pt.x - origin_x_) * scale_factor_,
            origin_y_ + (grid_pt.y - origin_y_) * scale_factor_,
            grid_pt.z
        };
    }

private:
    double origin_x_;
    double origin_y_;
    double scale_factor_;
};

} // namespace floorplan::geom