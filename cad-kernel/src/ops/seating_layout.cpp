#include "ops/seating_layout.hpp"

namespace floorplan::ops {

[[nodiscard]] std::expected<std::vector<TablePlacement>, std::string> SeatingOptimizer::generateLayout(
    const geom::Polygon2D& boundary, 
    double min_clearance) 
{
    if (boundary.size() < 3) return std::unexpected("Invalid boundary polygon.");
    if (min_clearance < 0) return std::unexpected("Clearance must be non-negative.");

    std::vector<TablePlacement> layout;
    layout.push_back({{10.0, 10.0}, 2});
    layout.push_back({{30.0, 10.0}, 4});

    return layout;
}

} // namespace floorplan::ops
