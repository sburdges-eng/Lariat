#pragma once
#include <cstddef>
#include <expected>
#include <optional>
#include <string>
#include <unordered_map>

#include "apple/graphics/engine.hpp"

namespace AppleGraphics::constructs {

// FloorPlan — the T7 construct, mirroring MenuDesigner (T6). It models a
// reconfigurable dining-room layout: TABLES (ObjectType::Table) parented under a
// single "floor" root node, with the construct owning its own TableData keyed by
// scene-node id (the engine's ObjectStore carries only scene metadata +
// geometry).
//
// Like every construct, it:
//   1. holds a non-owning reference to the engine,
//   2. creates its root ("floor") under the engine "root" in the constructor and
//      registers its Assistant Schemas (registerIntents()),
//   3. owns its domain data, keyed by scene-node id,
//   4. routes every mutation through the same four-step flow:
//        (a) engine.addObject / moveObject / removeObject   (scene + spatial index)
//        (b) update this construct's own data maps
//        (c) engine.collab().applyLocalOp("floor.<verb>", id, payloadJson) (sync)
//        (d) engine.synth().trigger(<SoundEvent>)            (procedural audio cue)
//
// A table is placed by its local transform (translation x,y) with local bounds
// {0,0,w,h}; resizing changes the bounds, which the engine has no primitive for,
// so resizeTable composes removeObject + addObject (same parent, same current
// transform, new bounds) while preserving TableData — mirroring MenuDesigner's
// reparent (snapshot/restore on failure).
//
// Not thread-safe on its own: it drives the engine (which serialises its own
// mutation) and collab/synth (independently safe). Use from a single owner
// thread, matching the other constructs.
class FloorPlan {
public:
    // Domain data owned by the construct, keyed by scene-node id. `status` is one
    // of {"open","seated","dirty","closed"} (default "open"); w/h mirror the
    // node's local bounds so resize can preserve everything but the geometry.
    struct TableData {
        std::string label;
        int capacity = 0;
        std::string status = "open";
        double w = 0.0;
        double h = 0.0;
        // Cached local placement (translation x,y). Position lives in the scene
        // node's transform; we mirror it here so resizeTable can re-add the node
        // at its SAME current transform (the engine exposes no local-transform
        // getter), and moveTable keeps it in sync.
        double x = 0.0;
        double y = 0.0;
    };

    // Creates the construct's root node (`rootId`, default "floor") under the
    // engine "root" and registers all Assistant Schemas. The engine must already
    // expose a "root" node (it always does).
    explicit FloorPlan(AppleUnifiedEngine& engine, std::string rootId = "floor");

    // Registers every Assistant Schema this construct exposes, each handler
    // parsing a ParamMap and forwarding to the matching typed method below.
    void registerIntents();

    // --- Typed mutating API (each returns void or an error string) ----------

    // Adds a table under the floor root at (x,y) with bounds {0,0,w,h}. Errors on
    // duplicate id, capacity < 1, or w/h <= 0.
    std::expected<void, std::string> addTable(const std::string& id,
                                              const std::string& label, int capacity,
                                              double x, double y, double w, double h);

    // Relocates a table to (x,y) via moveObject. Position lives in the transform;
    // TableData is unchanged. Errors on unknown table.
    std::expected<void, std::string> moveTable(const std::string& id, double x,
                                               double y);

    // Resizes a table's bounds to {0,0,w,h}. The engine has no bounds primitive,
    // so this is removeObject + addObject at the SAME current transform with new
    // bounds, preserving TableData (restoring old bounds on re-add failure).
    // Errors on unknown table or w/h <= 0.
    std::expected<void, std::string> resizeTable(const std::string& id, double w,
                                                 double h);

    // Sets a table's status (pure domain data). Errors on unknown table or an
    // out-of-set status value.
    std::expected<void, std::string> setTableStatus(const std::string& id,
                                                    const std::string& status);

    // Removes a table (scene node + data). Errors on unknown table.
    std::expected<void, std::string> removeTable(const std::string& id);

    // Auto-generates tables via floorplan::ops::SeatingOptimizer within a default
    // boundary rectangle of boundaryW x boundaryH. NOTE: SeatingOptimizer is
    // currently a STUB returning 2 fixed placements; this wiring produces real
    // tables from whatever the op yields and will scale up when the kernel op is
    // implemented. Errors on clearance < 0 or if generateLayout fails.
    std::expected<void, std::string> autoLayout(double clearance,
                                                double boundaryW = 200.0,
                                                double boundaryH = 200.0);

    // --- Accessors (for tests / read paths) ---------------------------------

    [[nodiscard]] const std::string& rootId() const { return rootId_; }

    // Set iff the constructor's root addObject failed (e.g. a duplicate rootId on
    // the same engine). When set, the construct is inert: it registered no intents
    // and every mutating method returns this error unchanged.
    [[nodiscard]] std::optional<std::string> initError() const { return init_error_; }

    [[nodiscard]] const TableData* table(const std::string& id) const;
    [[nodiscard]] std::size_t tableCount() const { return tables_.size(); }

private:
    AppleUnifiedEngine& engine_;
    std::string rootId_;
    std::optional<std::string> init_error_;
    std::unordered_map<std::string, TableData> tables_;
};

} // namespace AppleGraphics::constructs
