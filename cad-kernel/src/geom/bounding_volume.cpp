
#include "geom/bounding_volume.hpp"

namespace floorplan::geom {

[[nodiscard]] std::expected<void, std::string> BVH::build(const std::vector<AABB>& boxes) {
    if (boxes.empty()) return std::unexpected("Cannot build BVH with empty boxes.");

    nodes_.clear();
    nodes_.reserve(boxes.size() * 2);

    std::vector<uint32_t> indices(boxes.size());
    for (uint32_t i = 0; i < boxes.size(); ++i) indices[i] = i;

    nodes_.push_back(Node{});
    root_index_ = 0;

    buildRecursive(root_index_, boxes, indices);
    return {};
}

void BVH::buildRecursive(uint32_t node_idx, const std::vector<AABB>& boxes, const std::vector<uint32_t>& obj_indices) {
    if (obj_indices.size() == 1) {
        nodes_[node_idx].box = boxes[obj_indices[0]];
        nodes_[node_idx].left_child_or_obj = obj_indices[0];
        nodes_[node_idx].is_leaf = true;
        return;
    }

    AABB node_box = boxes[obj_indices[0]];
    for (size_t i = 1; i < obj_indices.size(); ++i) {
        node_box = node_box.merge(boxes[obj_indices[i]]);
    }
    nodes_[node_idx].box = node_box;
    nodes_[node_idx].is_leaf = false;

    std::vector<uint32_t> left_indices;
    std::vector<uint32_t> right_indices;
    double mid_x = (node_box.min_x + node_box.max_x) / 2.0;

    for (uint32_t idx : obj_indices) {
        double center_x = (boxes[idx].min_x + boxes[idx].max_x) / 2.0;
        if (center_x < mid_x) left_indices.push_back(idx);
        else right_indices.push_back(idx);
    }

    if (left_indices.empty() || right_indices.empty()) {
        size_t half = obj_indices.size() / 2;
        left_indices.assign(obj_indices.begin(), obj_indices.begin() + half);
        right_indices.assign(obj_indices.begin() + half, obj_indices.end());
    }

    uint32_t left_idx = nodes_.size();
    nodes_.push_back(Node{});
    uint32_t right_idx = nodes_.size();
    nodes_.push_back(Node{});

    nodes_[node_idx].left_child_or_obj = left_idx;
    nodes_[node_idx].right_child = right_idx;

    buildRecursive(left_idx, boxes, left_indices);
    buildRecursive(right_idx, boxes, right_indices);
}

[[nodiscard]] std::vector<uint32_t> BVH::query(const AABB& box) const {
    std::vector<uint32_t> results;
    if (nodes_.empty()) return results;

    std::vector<uint32_t> stack;
    stack.push_back(root_index_);

    while (!stack.empty()) {
        uint32_t idx = stack.back();
        stack.pop_back();

        const Node& node = nodes_[idx];
        if (node.box.intersects(box)) {
            if (node.is_leaf) {
                results.push_back(node.left_child_or_obj);
            } else {
                stack.push_back(node.left_child_or_obj);
                stack.push_back(node.right_child);
            }
        }
    }
    return results;
}

} // namespace floorplan::geom
