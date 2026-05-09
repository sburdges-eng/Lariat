#pragma once
#include <expected>
#include <string>

namespace floorplan::geom {

/**
 * @brief Represents a Parabolic Curve for vertical civil alignments.
 * Calculates elevation at a given station based on entering grade, exiting grade, and curve length.
 */
class VerticalParabola {
public:
    constexpr VerticalParabola(double pvc_station, double pvc_elevation, double grade_in, double grade_out, double length)
        : pvc_station_(pvc_station), pvc_elevation_(pvc_elevation), 
          grade_in_(grade_in), grade_out_(grade_out), length_(length) {}

    [[nodiscard]] std::expected<double, std::string> elevationAt(double station) const;

    [[nodiscard]] constexpr double rateOfChange() const {
        if (length_ == 0.0) return 0.0;
        return (grade_out_ - grade_in_) / length_;
    }

private:
    double pvc_station_;
    double pvc_elevation_;
    double grade_in_;
    double grade_out_;
    double length_;
};

} // namespace floorplan::geom
