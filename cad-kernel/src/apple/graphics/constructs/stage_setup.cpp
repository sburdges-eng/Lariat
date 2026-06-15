#include "apple/graphics/constructs/stage_setup.hpp"

#include <algorithm>
#include <string>
#include <utility>

namespace AppleGraphics::constructs {

namespace {

namespace geom = floorplan::geom;

// The stage root is a generic container at world origin (identity bounds box).
constexpr geom::AABB kStageBounds{0.0, 0.0, 0.0, 0.0};

// Every stage element gets a modest square footprint; position lives in the
// node's translation, so siblings at distinct (x,y) get distinct world AABBs and
// hit-testing has a unique answer per id.
constexpr double kElementW = 20.0;
constexpr double kElementH = 20.0;
constexpr geom::AABB kElementBounds{0.0, 0.0, kElementW, kElementH};

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

ObjectType StageSetup::objectTypeFor(ElementKind kind) {
    switch (kind) {
        case ElementKind::Channel:
            return ObjectType::Channel;
        case ElementKind::Monitor:
            return ObjectType::Monitor;
        case ElementKind::Instrument:
            return ObjectType::Instrument;
        case ElementKind::Rigging:
            return ObjectType::Rigging;
    }
    return ObjectType::Rigging; // unreachable; satisfies -Werror return path
}

StageSetup::StageSetup(AppleUnifiedEngine& engine, std::string rootId)
    : engine_(engine), rootId_(std::move(rootId)) {
    // The stage root parents the real elements so the whole plot can be
    // transformed/removed as a unit. It is not tracked in elements_ (it holds no
    // StageElementData). We model it as a Rigging-typed container at world origin.
    auto added = engine_.addObject("root", rootId_, ObjectType::Rigging,
                                   geom::AffineMatrix2D{}, kStageBounds, 0);
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

void StageSetup::registerIntents() {
    auto& intents = engine_.intents();

    // Registers one "Add<Kind>" intent {id,label,x,y} forwarding to addElement
    // with the fixed kind. Local helper keeps the four add intents in lockstep.
    auto registerAdd = [&](const char* name, const char* description,
                           ElementKind kind) {
        AssistantSchema s;
        s.name = name;
        s.description = description;
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"label", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"x", ParamType::Double, true, {}, {}, {}, {}},
            ParamSpec{"y", ParamType::Double, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this, kind](const ParamMap& p)
                -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                const auto& label = std::get<std::string>(p.at("label"));
                auto x = std::get<double>(p.at("x"));
                auto y = std::get<double>(p.at("y"));
                auto r = addElement(kind, id, label, x, y);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"added element " + id, id};
            });
    };

    registerAdd("AddChannel", "Add a channel (mic/DI) to the stage plot",
                ElementKind::Channel);
    registerAdd("AddMonitor", "Add a monitor mix to the stage plot",
                ElementKind::Monitor);
    registerAdd("AddInstrument", "Add an instrument to the stage plot",
                ElementKind::Instrument);
    registerAdd("AddRigging", "Add a rigging point to the stage plot",
                ElementKind::Rigging);

    {
        AssistantSchema s;
        s.name = "MoveElement";
        s.description = "Move a stage element to a new position";
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
                auto r = moveElement(id, x, y);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"moved element " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "AssignToMix";
        s.description = "Assign a channel to a monitor mix";
        s.params = {
            ParamSpec{"channelId", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"monitorId", ParamType::String, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& channelId = std::get<std::string>(p.at("channelId"));
                const auto& monitorId = std::get<std::string>(p.at("monitorId"));
                auto r = assignToMix(channelId, monitorId);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"assigned " + channelId + " to " + monitorId,
                                      monitorId};
            });
    }

    {
        AssistantSchema s;
        s.name = "SetSplLimit";
        s.description = "Set the stage SPL ceiling";
        s.params = {
            ParamSpec{"db", ParamType::Double, true, {}, 0.0, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                auto db = std::get<double>(p.at("db"));
                auto r = setSplLimit(db);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"set spl limit", {}};
            });
    }

    {
        AssistantSchema s;
        s.name = "RemoveElement";
        s.description = "Remove a stage element";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                auto r = removeElement(id);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"removed element " + id, id};
            });
    }
}

std::expected<void, std::string> StageSetup::addElement(ElementKind kind,
                                                        const std::string& id,
                                                        const std::string& label,
                                                        double x, double y) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    // FAIL FAST: validate before touching the engine.
    if (elements_.contains(id)) {
        return std::unexpected("duplicate element id: " + id);
    }

    // (a) scene + spatial index
    auto added = engine_.addObject(rootId_, id, objectTypeFor(kind),
                                   geom::AffineMatrix2D::translation(x, y),
                                   kElementBounds,
                                   static_cast<int>(elements_.size()));
    if (!added) {
        return std::unexpected(added.error());
    }
    // (b) construct data
    elements_.emplace(id, StageElementData{kind, label, x, y, std::nullopt, {}});
    // (c) collaboration op
    engine_.collab().applyLocalOp(
        "stage.addElement", id,
        "{\"kind\":" + std::to_string(static_cast<int>(kind)) +
            ",\"label\":" + jsonStr(label) + ",\"x\":" + jsonNum(x) +
            ",\"y\":" + jsonNum(y) + "}");
    // (d) audio cue
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectAdded);
    return {};
}

std::expected<void, std::string> StageSetup::moveElement(const std::string& id,
                                                         double x, double y) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    auto it = elements_.find(id);
    if (it == elements_.end()) {
        return std::unexpected("unknown element: " + id);
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
        "stage.moveElement", id,
        "{\"x\":" + jsonNum(x) + ",\"y\":" + jsonNum(y) + "}");
    // (d) audio cue
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectMoved);
    return {};
}

std::expected<void, std::string> StageSetup::assignToMix(
    const std::string& channelId, const std::string& monitorId) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    // FAIL FAST: validate both ends BEFORE any mutation so a bad assignment leaves
    // the plot untouched.
    auto chIt = elements_.find(channelId);
    if (chIt == elements_.end()) {
        return std::unexpected("unknown channel: " + channelId);
    }
    auto monIt = elements_.find(monitorId);
    if (monIt == elements_.end()) {
        return std::unexpected("unknown monitor: " + monitorId);
    }
    if (chIt->second.kind != ElementKind::Channel) {
        return std::unexpected("not a channel: " + channelId);
    }
    if (monIt->second.kind != ElementKind::Monitor) {
        return std::unexpected("not a monitor: " + monitorId);
    }

    // (a) no scene geometry change: assignment is pure domain data.
    // (b) construct data. If this channel is currently assigned to a DIFFERENT
    // monitor, drop it from that old monitor's list first so we never leave a
    // dangling reference (the channel lingering in the old mix while its mixId
    // points elsewhere). Reassigning to the SAME monitor skips this and stays an
    // idempotent no-dup success.
    if (chIt->second.mixId && !chIt->second.mixId->empty() &&
        *chIt->second.mixId != monitorId) {
        auto oldMonIt = elements_.find(*chIt->second.mixId);
        if (oldMonIt != elements_.end()) {
            auto& oldAssigned = oldMonIt->second.assignedChannels;
            oldAssigned.erase(
                std::remove(oldAssigned.begin(), oldAssigned.end(), channelId),
                oldAssigned.end());
        }
    }
    // Append the channel to the (new) monitor's mix (no dup) and stamp mixId.
    auto& assigned = monIt->second.assignedChannels;
    if (std::find(assigned.begin(), assigned.end(), channelId) == assigned.end()) {
        assigned.push_back(channelId);
    }
    chIt->second.mixId = monitorId;
    // (c) collaboration op
    engine_.collab().applyLocalOp(
        "stage.assignToMix", monitorId,
        "{\"channelId\":" + jsonStr(channelId) + "}");
    // (d) audio cue
    engine_.synth().trigger(AppleAudio::SoundEvent::Reconfigured);
    return {};
}

std::expected<void, std::string> StageSetup::setSplLimit(double db) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    if (db < 0.0) {
        return std::unexpected("spl limit must be >= 0");
    }
    // No scene mutation: the SPL ceiling is stage-level domain data. Still flow
    // through collab and an audio cue so the reconfiguration is replicated and
    // audible.
    splLimitDb_ = db;
    engine_.collab().applyLocalOp("stage.setSplLimit", rootId_,
                                  "{\"db\":" + jsonNum(db) + "}");
    engine_.synth().trigger(AppleAudio::SoundEvent::Reconfigured);
    return {};
}

std::expected<void, std::string> StageSetup::removeElement(const std::string& id) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    auto it = elements_.find(id);
    if (it == elements_.end()) {
        return std::unexpected("unknown element: " + id);
    }
    if (!engine_.removeObject(id)) {
        return std::unexpected("failed to remove element node: " + id);
    }

    // Clean up cross-references BEFORE erasing the data so no monitor/channel is
    // left pointing at a removed element.
    const ElementKind kind = it->second.kind;
    if (kind == ElementKind::Channel) {
        // Drop this channel from its monitor's assignedChannels, if assigned.
        if (it->second.mixId) {
            auto monIt = elements_.find(*it->second.mixId);
            if (monIt != elements_.end()) {
                auto& assigned = monIt->second.assignedChannels;
                assigned.erase(std::remove(assigned.begin(), assigned.end(), id),
                               assigned.end());
            }
        }
    } else if (kind == ElementKind::Monitor) {
        // Clear mixId on every channel that referenced this monitor.
        for (const auto& chId : it->second.assignedChannels) {
            auto chIt = elements_.find(chId);
            if (chIt != elements_.end() && chIt->second.mixId == id) {
                chIt->second.mixId.reset();
            }
        }
    }

    elements_.erase(it);
    engine_.collab().applyLocalOp("stage.removeElement", id, "{}");
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectRemoved);
    return {};
}

const StageSetup::StageElementData* StageSetup::element(const std::string& id) const {
    auto it = elements_.find(id);
    return it == elements_.end() ? nullptr : &it->second;
}

} // namespace AppleGraphics::constructs
