#pragma once
#include <expected>
#include <string>
#include <utility>

namespace floorplan::geom {

/**
 * @brief Evaluates an Euler/Clothoid spiral for horizontal civil alignments.
 * Curvature varies linearly with arc length.
 */
class ClothoidSpiral {
public:
    constexpr ClothoidSpiral(double x0, double y0, double theta0, double kappa0, double c_rate)
        : x0_(x0), y0_(y0), theta0_(theta0), kappa0_(kappa0), c_rate_(c_rate) {}

    /**
     * @brief Computes the (x, y) coordinate at arc length s using Fresnel integral approximations.
     * Fallible operation returns std::expected.
     */
    [[nodiscard]] std::expected<std::pair<double, double>, std::string> evaluateAtLength(double s) const;

private:
    double x0_, y0_, theta0_, kappa0_, c_rate_;
};

} // namespace floorplan::geom