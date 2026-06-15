#include "core/scene_graph.hpp"

#include <algorithm>

namespace floorplan::core {

[[nodiscard]] std::expected<void, std::string> SceneNode::addChild(std::unique_ptr<SceneNode> child) {
    if (!child) return std::unexpected("Cannot add a null child to SceneNode.");
    child->parent_ = this;
    children_.push_back(std::move(child));
    return {};
}

[[nodiscard]] std::expected<std::unique_ptr<SceneNode>, std::string> SceneNode::removeChild(const std::string& id) {
    auto it = std::find_if(children_.begin(), children_.end(),
                           [&id](const std::unique_ptr<SceneNode>& c) {
                               return c->id_ == id;
                           });
    if (it == children_.end()) {
        return std::unexpected("removeChild: no direct child with id: " + id);
    }
    std::unique_ptr<SceneNode> detached = std::move(*it);
    children_.erase(it);
    detached->parent_ = nullptr;
    return detached;
}

[[nodiscard]] geom::AffineMatrix2D SceneNode::computeGlobalTransform() const {
    if (parent_ == nullptr) {
        return local_transform_;
    }
    return parent_->computeGlobalTransform().multiply(local_transform_);
}

} // namespace floorplan::core
