#pragma once
#include <vector>
#include <expected>
#include <string>
#include <utility>

namespace floorplan::geom {

/**
 * @brief Parametric Bezier Curve evaluation using De Casteljau algorithm.
 */
class BezierCurve {
public:
    explicit BezierCurve(std::vector<std::pair<double, double>> control_points);

    [[nodiscard]] std::expected<std::pair<double, double>, std::string> evaluateAt(double t) const;

private:
    std::vector<std::pair<double, double>> control_points_;
};

} // namespace floorplan::geom