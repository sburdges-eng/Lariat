
#pragma once
#include <vector>
#include <cstdint>
#include <expected>
#include <string>

namespace floorplan::geom {

struct AABB {
    double min_x, min_y;
    double max_x, max_y;

    [[nodiscard]] constexpr bool intersects(const AABB& other) const {
        return (min_x <= other.max_x && max_x >= other.min_x) &&
               (min_y <= other.max_y && max_y >= other.min_y);
    }

    [[nodiscard]] constexpr AABB merge(const AABB& other) const {
        return {
            min_x < other.min_x ? min_x : other.min_x,
            min_y < other.min_y ? min_y : other.min_y,
            max_x > other.max_x ? max_x : other.max_x,
            max_y > other.max_y ? max_y : other.max_y
        };
    }
};

class BVH {
public:
    constexpr BVH() = default;

    [[nodiscard]] std::expected<void, std::string> build(const std::vector<AABB>& boxes);
    [[nodiscard]] std::vector<uint32_t> query(const AABB& box) const;

private:
    struct Node {
        AABB box;
        uint32_t left_child_or_obj; 
        uint32_t right_child;       
        bool is_leaf;
    };

    std::vector<Node> nodes_;
    uint32_t root_index_ = 0;

    void buildRecursive(uint32_t node_idx, const std::vector<AABB>& boxes, const std::vector<uint32_t>& obj_indices);
};

} // namespace floorplan::geom
