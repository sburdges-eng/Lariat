#include "apple/graphics/constructs/floor_plan.hpp"

#include <array>
#include <string>
#include <string_view>
#include <utility>

#include "ops/seating_layout.hpp"

namespace AppleGraphics::constructs {

namespace {

namespace geom = floorplan::geom;
namespace ops = floorplan::ops;

// The floor root is a generic container at world origin (identity bounds box).
constexpr geom::AABB kFloorBounds{0.0, 0.0, 0.0, 0.0};

// Allowed table statuses; mirrored in the SetTableStatus intent's allowedValues
// so the bridge rejects bad values before the handler runs, and validated here
// for the typed-method path.
constexpr std::array<std::string_view, 4> kStatuses{"open", "seated", "dirty",
                                                    "closed"};

[[nodiscard]] bool isValidStatus(const std::string& s) {
    for (auto v : kStatuses) {
        if (v == s) {
            return true;
        }
    }
    return false;
}

// Minimal JSON payload helpers for collab ops. Constructs serialise just enough
// to replay the mutation; deterministic key order keeps the log diffable.
[[nodiscard]] std::string jsonStr(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') {
            out.push_back('\\');
        }
        out.push_back(c);
    }
    out.push_back('"');
    return out;
}

[[nodiscard]] std::string jsonNum(double v) {
    return std::to_string(v);
}

} // namespace

FloorPlan::FloorPlan(AppleUnifiedEngine& engine, std::string rootId)
    : engine_(engine), rootId_(std::move(rootId)) {
    // The floor root parents the real tables so the whole layout can be
    // transformed/removed as a unit. It is not tracked in tables_ (it holds no
    // TableData). We model it as a Table-typed container at world origin.
    auto added = engine_.addObject("root", rootId_, ObjectType::Table,
                                   geom::AffineMatrix2D{}, kFloorBounds, 0);
    if (!added) {
        // The kernel uses std::expected, not exceptions; a failed root (e.g. a
        // duplicate rootId on this engine) leaves the construct inert. Record the
        // error and do NOT register intents — every mutating method will
        // short-circuit with this error instead.
        init_error_ = added.error();
        return;
    }
    registerIntents();
}

void FloorPlan::registerIntents() {
    auto& intents = engine_.intents();

    {
        AssistantSchema s;
        s.name = "AddTable";
        s.description = "Add a table to the floor plan";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"label", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"capacity", ParamType::Int, true, {}, 1.0, {}, {}},
            ParamSpec{"x", ParamType::Double, true, {}, {}, {}, {}},
            ParamSpec{"y", ParamType::Double, true, {}, {}, {}, {}},
            ParamSpec{"w", ParamType::Double, true, {}, 0.0, {}, {}},
            ParamSpec{"h", ParamType::Double, true, {}, 0.0, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                const auto& label = std::get<std::string>(p.at("label"));
                auto capacity = std::get<std::int64_t>(p.at("capacity"));
                auto x = std::get<double>(p.at("x"));
                auto y = std::get<double>(p.at("y"));
                auto w = std::get<double>(p.at("w"));
                auto h = std::get<double>(p.at("h"));
                auto r = addTable(id, label, static_cast<int>(capacity), x, y, w, h);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"added table " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "MoveTable";
        s.description = "Move a table to a new position";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"x", ParamType::Double, true, {}, {}, {}, {}},
            ParamSpec{"y", ParamType::Double, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                auto x = std::get<double>(p.at("x"));
                auto y = std::get<double>(p.at("y"));
                auto r = moveTable(id, x, y);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"moved table " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "ResizeTable";
        s.description = "Resize a table's footprint";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"w", ParamType::Double, true, {}, 0.0, {}, {}},
            ParamSpec{"h", ParamType::Double, true, {}, 0.0, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                auto w = std::get<double>(p.at("w"));
                auto h = std::get<double>(p.at("h"));
                auto r = resizeTable(id, w, h);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"resized table " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "SetTableStatus";
        s.description = "Set a table's status";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"status", ParamType::String, true, {}, {}, {},
                      {"open", "seated", "dirty", "closed"}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                const auto& status = std::get<std::string>(p.at("status"));
                auto r = setTableStatus(id, status);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"set status " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "RemoveTable";
        s.description = "Remove a table from the floor plan";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                auto r = removeTable(id);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"removed table " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "AutoLayout";
        s.description = "Auto-generate a seating layout";
        s.params = {
            ParamSpec{"clearance", ParamType::Double, true, {}, 0.0, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                auto clearance = std::get<double>(p.at("clearance"));
                auto r = autoLayout(clearance);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"auto layout generated", {}};
            });
    }
}

std::expected<void, std::string> FloorPlan::addTable(const std::string& id,
                                                     const std::string& label,
                                                     int capacity, double x, double y,
                                                     double w, double h) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    // FAIL FAST: validate everything before touching the engine.
    if (tables_.contains(id)) {
        return std::unexpected("duplicate table id: " + id);
    }
    if (capacity < 1) {
        return std::unexpected("capacity must be >= 1");
    }
    if (w <= 0.0 || h <= 0.0) {
        return std::unexpected("table dimensions must be > 0");
    }

    // (a) scene + spatial index
    auto added = engine_.addObject(rootId_, id, ObjectType::Table,
                                   geom::AffineMatrix2D::translation(x, y),
                                   geom::AABB{0.0, 0.0, w, h},
                                   static_cast<int>(tables_.size()));
    if (!added) {
        return std::unexpected(added.error());
    }
    // (b) construct data
    tables_.emplace(id, TableData{label, capacity, "open", w, h, x, y});
    // (c) collaboration op
    engine_.collab().applyLocalOp(
        "floor.addTable", id,
        "{\"label\":" + jsonStr(label) +
            ",\"capacity\":" + std::to_string(capacity) + ",\"x\":" + jsonNum(x) +
            ",\"y\":" + jsonNum(y) + ",\"w\":" + jsonNum(w) +
            ",\"h\":" + jsonNum(h) + "}");
    // (d) audio cue
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectAdded);
    return {};
}

std::expected<void, std::string> FloorPlan::moveTable(const std::string& id, double x,
                                                      double y) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    auto it = tables_.find(id);
    if (it == tables_.end()) {
        return std::unexpected("unknown table: " + id);
    }

    // (a) scene + spatial index
    auto moved = engine_.moveObject(id, geom::AffineMatrix2D::translation(x, y));
    if (!moved) {
        return std::unexpected(moved.error());
    }
    // (b) keep the cached placement in sync (position lives in the transform).
    it->second.x = x;
    it->second.y = y;
    // (c) collaboration op
    engine_.collab().applyLocalOp(
        "floor.moveTable", id,
        "{\"x\":" + jsonNum(x) + ",\"y\":" + jsonNum(y) + "}");
    // (d) audio cue
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectMoved);
    return {};
}

std::expected<void, std::string> FloorPlan::resizeTable(const std::string& id,
                                                        double w, double h) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    // FAIL FAST: validate before any engine mutation, so an invalid resize leaves
    // the table intact and hit-testable at its old footprint.
    auto it = tables_.find(id);
    if (it == tables_.end()) {
        return std::unexpected("unknown table: " + id);
    }
    if (w <= 0.0 || h <= 0.0) {
        return std::unexpected("table dimensions must be > 0");
    }

    // Snapshot the table's full prior state so we can restore it byte-for-byte if
    // the re-add fails after we've already detached the node. The engine has no
    // bounds primitive, so resize = removeObject + addObject at the SAME current
    // transform with new bounds (mirroring MenuDesigner's reparent).
    const TableData old = it->second;
    const auto transform = geom::AffineMatrix2D::translation(old.x, old.y);

    if (!engine_.removeObject(id)) {
        // Nothing was mutated; the table is still intact. Surface the failure.
        return std::unexpected("failed to detach table: " + id);
    }
    auto added = engine_.addObject(rootId_, id, ObjectType::Table, transform,
                                   geom::AABB{0.0, 0.0, w, h},
                                   static_cast<int>(tables_.size()) - 1);
    if (!added) {
        // Re-add failed after detach. Attempt to RESTORE the node at its OLD
        // bounds/transform so the resize is atomic from the caller's view.
        auto restored = engine_.addObject(rootId_, id, ObjectType::Table, transform,
                                          geom::AABB{0.0, 0.0, old.w, old.h},
                                          static_cast<int>(tables_.size()) - 1);
        if (restored) {
            // TableData still holds the old w/h, so it is already correct.
            return std::unexpected(added.error());
        }
        // Restore also failed: the scene node is truly gone. Drop the orphaned
        // domain data and report the loss explicitly.
        tables_.erase(id);
        return std::unexpected("table lost during resize: " + id +
                               " (re-add failed: " + added.error() +
                               "; restore failed: " + restored.error() + ")");
    }

    // Preserve all domain data; update only the geometry (w/h).
    it->second.w = w;
    it->second.h = h;
    engine_.collab().applyLocalOp(
        "floor.resizeTable", id,
        "{\"w\":" + jsonNum(w) + ",\"h\":" + jsonNum(h) + "}");
    engine_.synth().trigger(AppleAudio::SoundEvent::Reconfigured);
    return {};
}

std::expected<void, std::string> FloorPlan::setTableStatus(const std::string& id,
                                                           const std::string& status) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    auto it = tables_.find(id);
    if (it == tables_.end()) {
        return std::unexpected("unknown table: " + id);
    }
    if (!isValidStatus(status)) {
        return std::unexpected("invalid status: " + status);
    }
    // No scene mutation: status is pure domain data. Still flow through collab and
    // an audio cue so the reconfiguration is replicated and audible.
    it->second.status = status;
    engine_.collab().applyLocalOp("floor.setTableStatus", id,
                                  "{\"status\":" + jsonStr(status) + "}");
    engine_.synth().trigger(AppleAudio::SoundEvent::Reconfigured);
    return {};
}

std::expected<void, std::string> FloorPlan::removeTable(const std::string& id) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    if (!tables_.contains(id)) {
        return std::unexpected("unknown table: " + id);
    }
    if (!engine_.removeObject(id)) {
        return std::unexpected("failed to remove table node: " + id);
    }
    tables_.erase(id);
    engine_.collab().applyLocalOp("floor.removeTable", id, "{}");
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectRemoved);
    return {};
}

std::expected<void, std::string> FloorPlan::autoLayout(double clearance,
                                                       double boundaryW,
                                                       double boundaryH) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    if (clearance < 0.0) {
        return std::unexpected("clearance must be >= 0");
    }

    // Default boundary rectangle (CCW) of boundaryW x boundaryH at the origin.
    const geom::Polygon2D boundary{
        geom::Vertex2D{0.0, 0.0},
        geom::Vertex2D{boundaryW, 0.0},
        geom::Vertex2D{boundaryW, boundaryH},
        geom::Vertex2D{0.0, boundaryH},
    };

    // NOTE: SeatingOptimizer is currently a STUB that returns 2 fixed placements;
    // we wire it as the real layout source so this scales up automatically once
    // the kernel op is implemented.
    auto layout = ops::SeatingOptimizer::generateLayout(boundary, clearance);
    if (!layout) {
        return std::unexpected(layout.error());
    }

    // Each placement becomes a real table via the standard addTable flow (so it
    // gets its own scene node, collab op, and audio cue). Default footprint is a
    // modest square; capacity is derived from table_type.
    constexpr double kAutoW = 20.0;
    constexpr double kAutoH = 20.0;
    int n = 0;
    for (const auto& placement : *layout) {
        const std::string id = "auto-" + std::to_string(n);
        const std::string label = "Auto " + std::to_string(n);
        // Derive capacity from table_type, clamped to the >= 1 contract.
        const int capacity = placement.table_type > 0 ? placement.table_type : 1;
        auto r = addTable(id, label, capacity, placement.position.x,
                          placement.position.y, kAutoW, kAutoH);
        if (!r) {
            return std::unexpected(r.error());
        }
        ++n;
    }
    return {};
}

const FloorPlan::TableData* FloorPlan::table(const std::string& id) const {
    auto it = tables_.find(id);
    return it == tables_.end() ? nullptr : &it->second;
}

} // namespace AppleGraphics::constructs
