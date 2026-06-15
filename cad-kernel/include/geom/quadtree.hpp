#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include <expected>
#include "geom/bounding_volume.hpp"
#include "geom/boolean_ops.hpp"

namespace floorplan::geom {

// Region quadtree for 2D AABB hit-testing. Provides average O(log N) point and
// range queries by recursively subdividing world space into four quadrants when
// a node's entry count exceeds `capacity` and its depth is below `max_depth`.
//
// Straddle policy: an entry is stored at the DEEPEST node whose bounds fully
// contain the entry's box. An entry that straddles a quadrant boundary (so no
// single child fully contains it) stays at the parent node. This keeps each
// entry in exactly one place, so queries never deduplicate.
class Quadtree {
public:
    explicit Quadtree(const AABB& world_bounds,
                      std::size_t capacity = 8,
                      std::size_t max_depth = 8);

    // Inserts (id, box). Rejects a box that lies fully outside world bounds.
    [[nodiscard]] std::expected<void, std::string> insert(uint32_t id, const AABB& box);

    // Removes the entry with `id`. Returns true if it was found and removed.
    bool remove(uint32_t id);

    // Removes then reinserts `id` with a new box. Errors if the new box lies
    // fully outside world bounds (the old entry, if any, is left in place).
    [[nodiscard]] std::expected<void, std::string> update(uint32_t id, const AABB& box);

    // All ids whose box contains point p.
    [[nodiscard]] std::vector<uint32_t> queryPoint(const Vertex2D& p) const;

    // All ids whose box intersects box.
    [[nodiscard]] std::vector<uint32_t> queryRange(const AABB& box) const;

    [[nodiscard]] std::size_t size() const { return count_; }

private:
    struct Entry {
        uint32_t id;
        AABB box;
    };

    struct Node {
        AABB bounds;
        std::size_t depth;
        std::vector<Entry> entries;
        std::array<std::unique_ptr<Node>, 4> children;
        bool leaf = true;

        Node(const AABB& b, std::size_t d) : bounds(b), depth(d) {}
    };

    static bool contains(const AABB& outer, const AABB& inner);
    static bool containsPoint(const AABB& box, const Vertex2D& p);

    void subdivide(Node& node);
    void insertInto(Node& node, const Entry& entry);
    bool removeFrom(Node& node, uint32_t id);
    void queryPointInto(const Node& node, const Vertex2D& p, std::vector<uint32_t>& out) const;
    void queryRangeInto(const Node& node, const AABB& box, std::vector<uint32_t>& out) const;

    std::unique_ptr<Node> root_;
    std::size_t capacity_;
    std::size_t max_depth_;
    std::size_t count_ = 0;
};

} // namespace floorplan::geom
