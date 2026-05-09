#pragma once
#include <vector>
#include <memory>
#include <string>
#include <expected>
#include "geom/transform.hpp"

namespace floorplan::core {

class SceneNode {
public:
    explicit SceneNode(std::string id) : id_(std::move(id)) {}

    [[nodiscard]] std::string getId() const { return id_; }
    
    [[nodiscard]] geom::AffineMatrix2D getLocalTransform() const { return local_transform_; }
    void setLocalTransform(const geom::AffineMatrix2D& transform) { local_transform_ = transform; }

    [[nodiscard]] std::expected<void, std::string> addChild(std::unique_ptr<SceneNode> child);
    [[nodiscard]] geom::AffineMatrix2D computeGlobalTransform() const;

private:
    std::string id_;
    geom::AffineMatrix2D local_transform_;
    std::vector<std::unique_ptr<SceneNode>> children_;
};

} // namespace floorplan::core
