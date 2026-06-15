#pragma once
#include <cstddef>
#include <expected>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "apple/graphics/engine.hpp"

namespace AppleGraphics::constructs {

// StageSetup — the T8 construct, mirroring MenuDesigner (T6) and FloorPlan (T7).
// It models a reconfigurable stage plot: CHANNELS (mics/DIs), MONITOR mixes,
// INSTRUMENTS, and RIGGING points, all parented under a single "stage" root node.
// The construct owns its own StageElementData keyed by scene-node id (the
// engine's ObjectStore carries only scene metadata + geometry).
//
// Like every construct, it:
//   1. holds a non-owning reference to the engine,
//   2. creates its root ("stage") under the engine "root" in the constructor and
//      registers its Assistant Schemas (registerIntents()),
//   3. owns its domain data, keyed by scene-node id,
//   4. routes every mutation through the same four-step flow:
//        (a) engine.addObject / moveObject / removeObject   (scene + spatial index)
//        (b) update this construct's own data maps
//        (c) engine.collab().applyLocalOp("stage.<verb>", id, payloadJson) (sync)
//        (d) engine.synth().trigger(<SoundEvent>)            (procedural audio cue)
//
// Channel<->monitor mix model: a monitor mix references channel ids. Assigning a
// channel to a monitor appends the channel id to the monitor's assignedChannels
// (no duplicates) and stamps the channel's mixId with the monitor's id. This is
// pure domain data (no scene geometry changes), but still flows through collab +
// audio so the reconfiguration is replicated and audible. Removing a channel
// also drops it from its monitor's assignedChannels; removing a monitor clears
// mixId on every channel that referenced it — references are never left dangling.
//
// Not thread-safe on its own: it drives the engine (which serialises its own
// mutation) and collab/synth (independently safe). Use from a single owner
// thread, matching the other constructs.
class StageSetup {
public:
    // The four kinds of stage element, each mapped to a distinct ObjectType by
    // objectTypeFor().
    enum class ElementKind { Channel, Monitor, Instrument, Rigging };

    // Domain data owned by the construct, keyed by scene-node id. x/y mirror the
    // node's local placement (translation) so moveElement keeps them in sync.
    // `mixId` is set on a Channel when it is assigned to a Monitor.
    // `assignedChannels` is populated on a Monitor (the channel ids feeding it).
    struct StageElementData {
        ElementKind kind;
        std::string label;
        double x = 0.0;
        double y = 0.0;
        std::optional<std::string> mixId;       // set on a Channel: its monitor mix
        std::vector<std::string> assignedChannels; // set on a Monitor: its channels
    };

    // Creates the construct's root node (`rootId`, default "stage") under the
    // engine "root" and registers all Assistant Schemas. The engine must already
    // expose a "root" node (it always does). The stage root is a Rigging-typed
    // container at world origin (any ObjectType works; it holds no element data).
    explicit StageSetup(AppleUnifiedEngine& engine, std::string rootId = "stage");

    // Registers every Assistant Schema this construct exposes, each handler
    // parsing a ParamMap and forwarding to the matching typed method below.
    void registerIntents();

    // Maps a stage ElementKind to its scene ObjectType.
    [[nodiscard]] static ObjectType objectTypeFor(ElementKind kind);

    // --- Typed mutating API (each returns void or an error string) ----------

    // Adds a stage element of `kind` under the stage root at translation (x,y)
    // with bounds {0,0,20,20}. Errors on duplicate id. Used by the typed
    // AddChannel/AddMonitor/AddInstrument/AddRigging intents.
    std::expected<void, std::string> addElement(ElementKind kind,
                                                const std::string& id,
                                                const std::string& label, double x,
                                                double y);

    // Relocates an element to (x,y) via moveObject; syncs x,y in the data. Errors
    // on unknown element.
    std::expected<void, std::string> moveElement(const std::string& id, double x,
                                                 double y);

    // Assigns `channelId` to `monitorId`'s mix: appends the channel to the
    // monitor's assignedChannels (no dup) and sets the channel's mixId. Pure
    // domain data (no scene change). Errors on unknown ids, a non-Channel
    // channelId, or a non-Monitor monitorId.
    std::expected<void, std::string> assignToMix(const std::string& channelId,
                                                 const std::string& monitorId);

    // Sets the stage-level SPL ceiling for the plot. Errors on a negative value.
    std::expected<void, std::string> setSplLimit(double db);

    // Removes an element (scene node + data) and cleans up references: removing a
    // Channel drops it from its monitor's assignedChannels; removing a Monitor
    // clears mixId on every channel that referenced it. Errors on unknown element.
    std::expected<void, std::string> removeElement(const std::string& id);

    // --- Accessors (for tests / read paths) ---------------------------------

    [[nodiscard]] const std::string& rootId() const { return rootId_; }

    // Set iff the constructor's root addObject failed (e.g. a duplicate rootId on
    // the same engine). When set, the construct is inert: it registered no intents
    // and every mutating method returns this error unchanged.
    [[nodiscard]] std::optional<std::string> initError() const { return init_error_; }

    [[nodiscard]] const StageElementData* element(const std::string& id) const;
    [[nodiscard]] std::size_t elementCount() const { return elements_.size(); }
    [[nodiscard]] std::optional<double> splLimit() const { return splLimitDb_; }

private:
    AppleUnifiedEngine& engine_;
    std::string rootId_;
    std::optional<std::string> init_error_;
    std::unordered_map<std::string, StageElementData> elements_;
    // Stage-level SPL ceiling for the plot (unset until setSplLimit is called).
    std::optional<double> splLimitDb_;
};

} // namespace AppleGraphics::constructs
