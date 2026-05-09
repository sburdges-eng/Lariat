#include "geom/clothoid.hpp"
#include <cmath>

namespace floorplan::geom {

[[nodiscard]] std::expected<std::pair<double, double>, std::string> ClothoidSpiral::evaluateAtLength(double s) const {
    if (s < 0.0) {
        return std::unexpected("Arc length s must be non-negative.");
    }
    
    // Euler integration approximation for Fresnel integrals
    // x(s) = x0 + int_0^s cos(theta0 + k0*t + 0.5*c*t^2) dt
    // y(s) = y0 + int_0^s sin(theta0 + k0*t + 0.5*c*t^2) dt
    
    const int steps = 100;
    double ds = s / steps;
    double x = x0_;
    double y = y0_;
    
    for (int i = 0; i < steps; ++i) {
        double t = (i + 0.5) * ds;
        double theta = theta0_ + kappa0_ * t + 0.5 * c_rate_ * t * t;
        x += std::cos(theta) * ds;
        y += std::sin(theta) * ds;
    }
    
    return std::make_pair(x, y);
}

} // namespace floorplan::geom