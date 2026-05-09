#pragma once
#include <vector>
#include <expected>
#include <string>
#include "geom/boolean_ops.hpp"

namespace floorplan::ops {

struct TablePlacement {
    geom::Vertex2D position;
    int table_type; 
};

/**
 * @brief Algorithmic solver for optimal seating arrangements.
 */
class SeatingOptimizer {
public:
    /**
     * @brief Auto-generates a seating layout within a given boundary.
     */
    [[nodiscard]] static std::expected<std::vector<TablePlacement>, std::string> generateLayout(
        const geom::Polygon2D& boundary, 
        double min_clearance
    );
};

} // namespace floorplan::ops
