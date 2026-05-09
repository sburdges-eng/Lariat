#include "geom/vertical_alignment.hpp"

namespace floorplan::geom {

[[nodiscard]] std::expected<double, std::string> VerticalParabola::elevationAt(double station) const {
    if (length_ <= 0.0) return std::unexpected("Curve length must be strictly positive.");
    
    double x = station - pvc_station_;
    if (x < 0.0 || x > length_) {
        return std::unexpected("Station is outside the bounds of the vertical curve.");
    }
    
    double r = rateOfChange();
    double elevation = pvc_elevation_ + (grade_in_ * x) + (0.5 * r * x * x);
    
    return elevation;
}

} // namespace floorplan::geom
