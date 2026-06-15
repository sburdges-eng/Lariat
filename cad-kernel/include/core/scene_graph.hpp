#pragma once
#include <vector>
#include <memory>
#include <span>
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

    // parent_ is a non-owning observer pointer: the parent owns the child via
    // unique_ptr, so the back-reference must not participate in ownership.
    [[nodiscard]] const SceneNode* getParent() const { return parent_; }
    [[nodiscard]] SceneNode* getParent() { return parent_; }

    [[nodiscard]] std::span<const std::unique_ptr<SceneNode>> children() const { return children_; }

private:
    std::string id_;
    geom::AffineMatrix2D local_transform_;
    std::vector<std::unique_ptr<SceneNode>> children_;
    SceneNode* parent_ = nullptr;
};

} // namespace floorplan::core
