#pragma once
#include <expected>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

#include "apple/graphics/intents_bridge.hpp"
#include "apple/graphics/render_backend.hpp"
#include "apple/graphics/scene_object.hpp"
#include "apple/graphics/types.hpp"
#include "core/scene_graph.hpp"
#include "geom/bounding_volume.hpp"
#include "geom/quadtree.hpp"
#include "geom/transform.hpp"

namespace AppleGraphics {

namespace core = floorplan::core;
namespace geom = floorplan::geom;

// Core of the unified engine (T2). Owns the scene graph root, the object store,
// a spatial index (quadtree), and a render backend. All mutating operations and
// shared reads are guarded by an internal mutex.
//
// Later tasks extend update() to drain an intent queue and flush collaboration
// ops; T2 implements only scene construction, spatial bookkeeping, hit-testing,
// and frame drive.
class AppleUnifiedEngine {
public:
    explicit AppleUnifiedEngine(
        geom::AABB worldBounds = {-1e4, -1e4, 1e4, 1e4},
        std::unique_ptr<RenderBackend> backend = nullptr);

    // Adds a child object under `parentId` ("root" is the root node). Creates a
    // SceneNode with the given local transform, computes its world AABB from the
    // 4 corners of `localBounds` through the node's global transform, and
    // registers it in the store and quadtree. Errors if the parent is missing or
    // `id` already exists.
    std::expected<void, std::string> addObject(
        const std::string& parentId,
        const std::string& id,
        ObjectType type,
        const geom::AffineMatrix2D& localTransform,
        const geom::AABB& localBounds,
        int zOrder);

    // Updates the node's local transform and recomputes the world AABB for the
    // node and every descendant (whose global transforms also changed),
    // updating each in the quadtree. Errors if `id` is unknown.
    std::expected<void, std::string> moveObject(
        const std::string& id,
        const geom::AffineMatrix2D& newLocalTransform);

    // Removes `id` and its whole subtree from the quadtree and store. Returns
    // false if `id` is unknown or refers to the root (root removal disallowed).
    bool removeObject(const std::string& id);

    // Returns the id of the topmost (highest zOrder) object whose world bounds
    // contain `worldPoint`, or nullopt if none.
    [[nodiscard]] std::optional<std::string> hitTest(const geom::Vertex2D& worldPoint) const;

    // Drives one frame through the render backend.
    void update();

    [[nodiscard]] const core::SceneNode& root() const { return *root_; }
    [[nodiscard]] ObjectStore& store() { return store_; }
    [[nodiscard]] const geom::Quadtree& quadtree() const { return quad_; }
    [[nodiscard]] RenderBackend& renderer() { return *renderer_; }

    // The engine's App Intents bridge. Later constructs register their Assistant
    // Schemas on this shared bridge so an assistant can drive them. Dispatch is
    // synchronous (no intent queue): the bridge runs the handler inline, and any
    // engine-mutating handler is expected to go through the engine's own locked
    // API, so update() is not involved.
    [[nodiscard]] AppIntentsBridge& intents() { return intents_; }

    [[nodiscard]] std::optional<ObjectType> typeOf(const std::string& id) const;
    [[nodiscard]] std::optional<geom::AffineMatrix2D> globalTransformOf(const std::string& id) const;

private:
    std::unique_ptr<core::SceneNode> root_;
    ObjectStore store_;
    geom::Quadtree quad_;
    std::unique_ptr<RenderBackend> renderer_;
    AppIntentsBridge intents_;
    mutable std::mutex mutex_;

    // O(1) id -> raw node lookup, maintained on add/remove. Raw pointers are
    // non-owning; ownership lives in the scene graph (root_ and its children).
    std::unordered_map<std::string, core::SceneNode*> index_;

    // id -> local (untransformed) bounds, needed to recompute world AABBs when
    // a transform changes. Kept here rather than in ObjectMeta to keep the
    // store's metadata fixed and free of geometry payloads.
    std::unordered_map<std::string, geom::AABB> local_bounds_;
};

} // namespace AppleGraphics
