#include "geom/quadtree.hpp"

namespace floorplan::geom {

Quadtree::Quadtree(const AABB& world_bounds, std::size_t capacity, std::size_t max_depth)
    : root_(std::make_unique<Node>(world_bounds, 0)),
      capacity_(capacity == 0 ? 1 : capacity),
      max_depth_(max_depth) {}

bool Quadtree::contains(const AABB& outer, const AABB& inner) {
    return inner.min_x >= outer.min_x && inner.max_x <= outer.max_x &&
           inner.min_y >= outer.min_y && inner.max_y <= outer.max_y;
}

bool Quadtree::containsPoint(const AABB& box, const Vertex2D& p) {
    return p.x >= box.min_x && p.x <= box.max_x &&
           p.y >= box.min_y && p.y <= box.max_y;
}

void Quadtree::subdivide(Node& node) {
    const double mid_x = (node.bounds.min_x + node.bounds.max_x) * 0.5;
    const double mid_y = (node.bounds.min_y + node.bounds.max_y) * 0.5;
    const std::size_t d = node.depth + 1;

    // 0: SW, 1: SE, 2: NW, 3: NE
    node.children[0] = std::make_unique<Node>(
        AABB{node.bounds.min_x, node.bounds.min_y, mid_x, mid_y}, d);
    node.children[1] = std::make_unique<Node>(
        AABB{mid_x, node.bounds.min_y, node.bounds.max_x, mid_y}, d);
    node.children[2] = std::make_unique<Node>(
        AABB{node.bounds.min_x, mid_y, mid_x, node.bounds.max_y}, d);
    node.children[3] = std::make_unique<Node>(
        AABB{mid_x, mid_y, node.bounds.max_x, node.bounds.max_y}, d);
    node.leaf = false;

    // Re-home existing entries into any child that fully contains them.
    std::vector<Entry> retained;
    retained.reserve(node.entries.size());
    for (const auto& e : node.entries) {
        bool placed = false;
        for (auto& child : node.children) {
            if (contains(child->bounds, e.box)) {
                insertInto(*child, e);
                placed = true;
                break;
            }
        }
        if (!placed) retained.push_back(e);
    }
    node.entries = std::move(retained);
}

void Quadtree::insertInto(Node& node, const Entry& entry) {
    // Descend into a child only if it fully contains the entry's box.
    if (!node.leaf) {
        for (auto& child : node.children) {
            if (contains(child->bounds, entry.box)) {
                insertInto(*child, entry);
                return;
            }
        }
        // Straddles a boundary: store at this node.
        node.entries.push_back(entry);
        return;
    }

    node.entries.push_back(entry);

    if (node.entries.size() > capacity_ && node.depth < max_depth_) {
        subdivide(node);
    }
}

std::expected<void, std::string> Quadtree::insert(uint32_t id, const AABB& box) {
    if (!box.intersects(root_->bounds)) {
        return std::unexpected("Quadtree::insert: box lies fully outside world bounds.");
    }
    insertInto(*root_, Entry{id, box});
    ++count_;
    return {};
}

bool Quadtree::removeFrom(Node& node, uint32_t id) {
    for (auto it = node.entries.begin(); it != node.entries.end(); ++it) {
        if (it->id == id) {
            node.entries.erase(it);
            return true;
        }
    }
    if (!node.leaf) {
        for (auto& child : node.children) {
            if (removeFrom(*child, id)) return true;
        }
    }
    return false;
}

bool Quadtree::remove(uint32_t id) {
    if (removeFrom(*root_, id)) {
        --count_;
        return true;
    }
    return false;
}

std::expected<void, std::string> Quadtree::update(uint32_t id, const AABB& box) {
    if (!box.intersects(root_->bounds)) {
        return std::unexpected("Quadtree::update: new box lies fully outside world bounds.");
    }
    remove(id);
    return insert(id, box);
}

void Quadtree::queryPointInto(const Node& node, const Vertex2D& p,
                              std::vector<uint32_t>& out) const {
    for (const auto& e : node.entries) {
        if (containsPoint(e.box, p)) out.push_back(e.id);
    }
    if (!node.leaf) {
        for (const auto& child : node.children) {
            if (containsPoint(child->bounds, p)) {
                queryPointInto(*child, p, out);
            }
        }
    }
}

std::vector<uint32_t> Quadtree::queryPoint(const Vertex2D& p) const {
    std::vector<uint32_t> out;
    queryPointInto(*root_, p, out);
    return out;
}

void Quadtree::queryRangeInto(const Node& node, const AABB& box,
                              std::vector<uint32_t>& out) const {
    for (const auto& e : node.entries) {
        if (e.box.intersects(box)) out.push_back(e.id);
    }
    if (!node.leaf) {
        for (const auto& child : node.children) {
            if (child->bounds.intersects(box)) {
                queryRangeInto(*child, box, out);
            }
        }
    }
}

std::vector<uint32_t> Quadtree::queryRange(const AABB& box) const {
    std::vector<uint32_t> out;
    queryRangeInto(*root_, box, out);
    return out;
}

} // namespace floorplan::geom
