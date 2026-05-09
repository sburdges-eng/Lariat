#include "geom/curves.hpp"

namespace floorplan::geom {

BezierCurve::BezierCurve(std::vector<std::pair<double, double>> control_points) 
    : control_points_(std::move(control_points)) {}

[[nodiscard]] std::expected<std::pair<double, double>, std::string> BezierCurve::evaluateAt(double t) const {
    if (control_points_.empty()) {
        return std::unexpected("Cannot evaluate Bezier curve with zero control points.");
    }
    if (t < 0.0 || t > 1.0) {
        return std::unexpected("Parameter t must be between 0.0 and 1.0 inclusive.");
    }

    auto pts = control_points_;
    size_t n = pts.size();

    for (size_t k = 1; k < n; ++k) {
        for (size_t i = 0; i < n - k; ++i) {
            pts[i].first = (1.0 - t) * pts[i].first + t * pts[i + 1].first;
            pts[i].second = (1.0 - t) * pts[i].second + t * pts[i + 1].second;
        }
    }

    return pts[0];
}

} // namespace floorplan::geom