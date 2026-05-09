#include "geom/crs.hpp"
#include <cmath>

namespace floorplan::geom {

[[nodiscard]] std::expected<GeoPoint3D, std::string> CRSEngine::transformDatum(const GeoPoint3D& pt, const HelmertParams& params) {
    // Convert arc-seconds to radians
    const double arcsec_to_rad = M_PI / (180.0 * 3600.0);
    double rx_rad = params.rx * arcsec_to_rad;
    double ry_rad = params.ry * arcsec_to_rad;
    double rz_rad = params.rz * arcsec_to_rad;

    // Convert scale from ppm to absolute scale factor
    double s = params.scale_ppm / 1000000.0;

    // Apply Helmert Transformation (Bursa-Wolf model / Position Vector Transformation)
    // Formula: P_new = T + (1 + s) * R * P_old
    // R is the rotation matrix approximated for small angles:
    // [  1   -rz   ry ]
    // [  rz   1   -rx ]
    // [ -ry   rx   1  ]

    double x_new = params.tx + (1.0 + s) * (pt.x - rz_rad * pt.y + ry_rad * pt.z);
    double y_new = params.ty + (1.0 + s) * (rz_rad * pt.x + pt.y - rx_rad * pt.z);
    double z_new = params.tz + (1.0 + s) * (-ry_rad * pt.x + rx_rad * pt.y + pt.z);

    return GeoPoint3D{x_new, y_new, z_new};
}

} // namespace floorplan::geom
