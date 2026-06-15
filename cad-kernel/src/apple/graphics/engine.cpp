#include "apple/graphics/engine.hpp"

#include <algorithm>
#include <array>
#include <limits>
#include <vector>

namespace AppleGraphics {

namespace {

// Transforms the 4 corners of `localBounds` through `globalTransform` and
// returns the axis-aligned box enclosing the result. This is the world AABB
// used as the quadtree key, so it must account for rotation/scale, not just
// translation.
geom::AABB worldAABBFor(const geom::AffineMatrix2D& globalTransform,
                        const geom::AABB& localBounds) {
    const std::array<std::pair<double, double>, 4> corners = {{
        {localBounds.min_x, localBounds.min_y},
        {localBounds.max_x, localBounds.min_y},
        {localBounds.max_x, localBounds.max_y},
        {localBounds.min_x, localBounds.max_y},
    }};

    double min_x = std::numeric_limits<double>::max();
    double min_y = std::numeric_limits<double>::max();
    double max_x = std::numeric_limits<double>::lowest();
    double max_y = std::numeric_limits<double>::lowest();

    for (const auto& [cx, cy] : corners) {
        const auto [wx, wy] = globalTransform.transformPoint(cx, cy);
        min_x = std::min(min_x, wx);
        min_y = std::min(min_y, wy);
        max_x = std::max(max_x, wx);
        max_y = std::max(max_y, wy);
    }
    return geom::AABB{min_x, min_y, max_x, max_y};
}

// Appends `node` and all descendants (pre-order) to `out`.
void collectSubtree(core::SceneNode& node, std::vector<core::SceneNode*>& out) {
    out.push_back(&node);
    for (const auto& child : node.children()) {
        collectSubtree(*child, out);
    }
}

} // namespace

AppleUnifiedEngine::AppleUnifiedEngine(geom::AABB worldBounds,
                                       std::unique_ptr<RenderBackend> backend)
    : root_(std::make_unique<core::SceneNode>("root")),
      quad_(worldBounds),
      renderer_(backend ? std::move(backend)
                        : std::make_unique<NullRenderBackend>()) {
    index_["root"] = root_.get();
}

std::expected<void, std::string> AppleUnifiedEngine::addObject(
    const std::string& parentId,
    const std::string& id,
    ObjectType type,
    const geom::AffineMatrix2D& localTransform,
    const geom::AABB& localBounds,
    int zOrder) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (index_.contains(id)) {
        return std::unexpected("addObject: id already exists: " + id);
    }
    auto parentIt = index_.find(parentId);
    if (parentIt == index_.end()) {
        return std::unexpected("addObject: parent not found: " + parentId);
    }
    core::SceneNode* parent = parentIt->second;

    auto child = std::make_unique<core::SceneNode>(id);
    child->setLocalTransform(localTransform);
    core::SceneNode* childPtr = child.get();

    if (auto added = parent->addChild(std::move(child)); !added) {
        return std::unexpected(added.error());
    }

    const geom::AABB worldBounds =
        worldAABBFor(childPtr->computeGlobalTransform(), localBounds);

    const std::uint32_t handle =
        store_.add(id, ObjectMeta{type, zOrder, worldBounds, 0});

    if (auto inserted = quad_.insert(handle, worldBounds); !inserted) {
        // Roll back the store registration; the node stays in the graph but is
        // not engine-tracked. (Out-of-world-bounds boxes are the only failure.)
        store_.remove(id);
        return std::unexpected(inserted.error());
    }

    index_[id] = childPtr;
    local_bounds_[id] = localBounds;
    return {};
}

std::expected<void, std::string> AppleUnifiedEngine::moveObject(
    const std::string& id,
    const geom::AffineMatrix2D& newLocalTransform) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = index_.find(id);
    if (it == index_.end()) {
        return std::unexpected("moveObject: id not found: " + id);
    }
    core::SceneNode* node = it->second;
    node->setLocalTransform(newLocalTransform);

    // The node and every descendant now have new global transforms, so each of
    // their world AABBs changes. Recompute from each node's retained local
    // bounds (local_bounds_) through its new global transform, and refresh the
    // quadtree key in place.
    std::vector<core::SceneNode*> subtree;
    collectSubtree(*node, subtree);

    for (core::SceneNode* n : subtree) {
        const std::string& nid = n->getId();
        ObjectMeta* meta = store_.find(nid);
        auto lbIt = local_bounds_.find(nid);
        if (meta == nullptr || lbIt == local_bounds_.end()) {
            continue; // not engine-tracked (shouldn't happen for indexed nodes)
        }
        const geom::AABB newWorld =
            worldAABBFor(n->computeGlobalTransform(), lbIt->second);
        meta->worldBounds = newWorld;
        if (auto updated = quad_.update(meta->handle, newWorld); !updated) {
            return std::unexpected(updated.error());
        }
    }
    return {};
}

bool AppleUnifiedEngine::removeObject(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (id == "root") {
        return false;
    }
    auto it = index_.find(id);
    if (it == index_.end()) {
        return false;
    }

    core::SceneNode* node = it->second;
    core::SceneNode* parent = node->getParent();

    std::vector<core::SceneNode*> subtree;
    collectSubtree(*node, subtree);

    // Purge every descendant handle from the store/quadtree/index BEFORE
    // detaching, while the subtree pointers are still valid.
    for (core::SceneNode* n : subtree) {
        const std::string& nid = n->getId();
        if (const ObjectMeta* meta = store_.find(nid)) {
            quad_.remove(meta->handle);
        }
        store_.remove(nid);
        index_.erase(nid);
        local_bounds_.erase(nid);
    }

    // Detach the node from its parent's children_. The returned unique_ptr is
    // dropped here, freeing the node and its whole subtree, so renderFrame no
    // longer walks orphaned nodes. (Indexed non-root nodes always have a
    // parent; if not, the engine state is already fully purged above.)
    if (parent != nullptr) {
        (void)parent->removeChild(id);
    }
    return true;
}

std::optional<std::string> AppleUnifiedEngine::hitTest(
    const geom::Vertex2D& worldPoint) const {
    std::lock_guard<std::mutex> lock(mutex_);

    const std::vector<std::uint32_t> handles = quad_.queryPoint(worldPoint);

    std::optional<std::string> best;
    int bestZ = std::numeric_limits<int>::min();
    for (std::uint32_t handle : handles) {
        const std::string* hid = store_.idForHandle(handle);
        if (hid == nullptr) {
            continue;
        }
        const ObjectMeta* meta = store_.find(*hid);
        if (meta == nullptr) {
            continue;
        }
        if (!best.has_value() || meta->zOrder > bestZ) {
            bestZ = meta->zOrder;
            best = *hid;
        }
    }
    return best;
}

void AppleUnifiedEngine::update() {
    std::lock_guard<std::mutex> lock(mutex_);
    renderer_->renderFrame(*root_);
}

std::optional<ObjectType> AppleUnifiedEngine::typeOf(const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (const ObjectMeta* meta = store_.find(id)) {
        return meta->type;
    }
    return std::nullopt;
}

std::optional<geom::AffineMatrix2D> AppleUnifiedEngine::globalTransformOf(
    const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = index_.find(id);
    if (it == index_.end()) {
        return std::nullopt;
    }
    return it->second->computeGlobalTransform();
}

} // namespace AppleGraphics
