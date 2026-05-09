#include "core/scene_graph.hpp"

namespace floorplan::core {

[[nodiscard]] std::expected<void, std::string> SceneNode::addChild(std::unique_ptr<SceneNode> child) {
    if (!child) return std::unexpected("Cannot add a null child to SceneNode.");
    children_.push_back(std::move(child));
    return {};
}

[[nodiscard]] geom::AffineMatrix2D SceneNode::computeGlobalTransform() const {
    return local_transform_;
}

} // namespace floorplan::core
