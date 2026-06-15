#pragma once
#include <cstdint>
#include <string>
#include <unordered_map>

#include "apple/graphics/types.hpp"
#include "geom/bounding_volume.hpp" // floorplan::geom::AABB

namespace AppleGraphics {

namespace geom = floorplan::geom;

// Lightweight render/spatial metadata for a scene object. Deliberately generic:
// it carries only what the engine needs for hit-testing and draw ordering.
// Construct-specific payloads (menu prices, channel routing, rigging loads...)
// are owned by the constructs in later tasks, keyed by node id — never here.
struct ObjectMeta {
    ObjectType type;
    int zOrder;
    geom::AABB worldBounds;
    std::uint32_t handle;
};

// Bidirectional registry mapping a scene-graph node id to its ObjectMeta and to
// a stable uint32 handle (the value used as the quadtree key). Handles are
// auto-incremented and never reused within the lifetime of the store.
class ObjectStore {
public:
    // Registers `id` with `meta`, assigning a fresh handle (written into the
    // stored meta and returned). If `id` already exists it is overwritten and
    // re-handled.
    std::uint32_t add(const std::string& id, ObjectMeta meta);

    // Removes the entry for `id`. Returns true if it existed.
    bool remove(const std::string& id);

    [[nodiscard]] const ObjectMeta* find(const std::string& id) const;
    [[nodiscard]] ObjectMeta* find(const std::string& id);

    // Reverse lookup: id owning a given handle, or nullptr if unknown.
    [[nodiscard]] const std::string* idForHandle(std::uint32_t handle) const;

    [[nodiscard]] std::size_t size() const { return by_id_.size(); }

private:
    std::unordered_map<std::string, ObjectMeta> by_id_;
    std::unordered_map<std::uint32_t, std::string> handle_to_id_;
    std::uint32_t next_handle_ = 1; // 0 reserved as "no handle"
};

} // namespace AppleGraphics
