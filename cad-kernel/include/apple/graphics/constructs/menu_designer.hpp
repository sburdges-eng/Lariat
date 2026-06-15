#pragma once
#include <cstdint>
#include <expected>
#include <optional>
#include <string>
#include <unordered_map>

#include "apple/graphics/engine.hpp"

namespace AppleGraphics::constructs {

// MenuDesigner — the first "construct" built on top of AppleUnifiedEngine and the
// reference for the construct pattern that FloorPlan (T7) and StageSetup (T8)
// mirror.
//
// A construct is a thin domain layer that:
//   1. holds a non-owning reference to the engine,
//   2. creates a single root node (here "menu") under the engine "root" in its
//      constructor and registers its Assistant Schemas (registerIntents()),
//   3. owns its domain data, keyed by scene-node id, decoupled from the engine's
//      ObjectStore (the store only carries scene metadata + geometry),
//   4. routes every mutation through the same four-step flow:
//        (a) engine.addObject / moveObject / removeObject   (scene + spatial index)
//        (b) update this construct's own data maps
//        (c) engine.collab().applyLocalOp("menu.<verb>", id, payloadJson)  (sync)
//        (d) engine.synth().trigger(<SoundEvent>)            (procedural audio cue)
//
// A MenuDesigner models a reconfigurable menu: the "menu" root contains ordered
// SECTIONS (ObjectType::MenuSection), each containing ordered ITEMS
// (ObjectType::MenuItem). Sections are laid out vertically by order under the
// menu root; items are laid out vertically by order within their section. The
// menu root itself is a MenuSection node (a generic container) at world origin.
//
// Not thread-safe on its own: it drives the engine, which serialises its own
// mutation, and collab/synth which are independently safe. A construct is
// expected to be used from a single owner thread, matching the other constructs.
class MenuDesigner {
public:
    // Domain data owned by the construct, keyed by scene-node id.
    struct SectionData {
        std::string name;
        int order; // 0-based position of the section under the menu root
    };
    struct ItemData {
        std::string name;
        std::int64_t priceCents;
        std::string sectionId; // owning section's node id
        int order;             // 0-based position of the item within its section
    };

    // Creates the construct's root node (`rootId`, default "menu") under the
    // engine "root" and registers all Assistant Schemas. The engine must already
    // expose a "root" node (it always does).
    explicit MenuDesigner(AppleUnifiedEngine& engine, std::string rootId = "menu");

    // Registers every Assistant Schema this construct exposes, each handler
    // parsing a ParamMap and forwarding to the matching typed method below.
    void registerIntents();

    // --- Typed mutating API (each returns void or an error string) ----------

    // Adds a section under the menu root. Errors on duplicate id.
    std::expected<void, std::string> addSection(const std::string& id,
                                                const std::string& name);

    // Adds an item under `sectionId`. Errors on unknown section or duplicate id.
    std::expected<void, std::string> addItem(const std::string& sectionId,
                                             const std::string& id,
                                             const std::string& name,
                                             std::int64_t priceCents);

    // Updates an item's price. Errors on unknown item.
    std::expected<void, std::string> setItemPrice(const std::string& id,
                                                  std::int64_t priceCents);

    // Renames an item. Errors on unknown item.
    std::expected<void, std::string> renameItem(const std::string& id,
                                                const std::string& name);

    // Reparents an item into `targetSectionId`, preserving its ItemData and
    // recomputing its order/transform in the new section. Errors on unknown item
    // or unknown target section.
    std::expected<void, std::string> moveItemToSection(
        const std::string& id, const std::string& targetSectionId);

    // Removes an item (scene node + data). Errors on unknown item.
    std::expected<void, std::string> removeItem(const std::string& id);

    // --- Accessors (for tests / read paths) ---------------------------------

    [[nodiscard]] const std::string& rootId() const { return rootId_; }

    // Set iff the constructor's root addObject failed (e.g. a duplicate rootId on
    // the same engine). When set, the construct is inert: it registered no intents
    // and every mutating method returns this error unchanged.
    [[nodiscard]] std::optional<std::string> initError() const { return init_error_; }

    [[nodiscard]] const ItemData* item(const std::string& id) const;
    [[nodiscard]] const SectionData* section(const std::string& id) const;
    [[nodiscard]] std::size_t itemCount() const { return items_.size(); }
    [[nodiscard]] std::size_t sectionCount() const { return sections_.size(); }

private:
    // Number of items currently parented under `sectionId` (their next order).
    [[nodiscard]] int itemsInSection(const std::string& sectionId) const;

    AppleUnifiedEngine& engine_;
    std::string rootId_;
    std::optional<std::string> init_error_;
    std::unordered_map<std::string, SectionData> sections_;
    std::unordered_map<std::string, ItemData> items_;
};

} // namespace AppleGraphics::constructs
