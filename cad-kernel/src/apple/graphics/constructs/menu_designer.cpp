#include "apple/graphics/constructs/menu_designer.hpp"

#include <string>
#include <utility>

namespace AppleGraphics::constructs {

namespace {

namespace geom = floorplan::geom;

// Layout constants. Sections stack downward under the menu root; items stack
// downward within their section. Vertical spacing exceeds each node's height so
// sibling world AABBs do not overlap, giving hit-testing a unique answer per id.
constexpr double kSectionHeight = 30.0;
constexpr double kSectionWidth = 240.0;
constexpr double kSectionSpacing = 40.0;
constexpr double kItemHeight = 24.0;
constexpr double kItemWidth = 220.0;
constexpr double kItemSpacing = 30.0;

constexpr geom::AABB kSectionBounds{0.0, 0.0, kSectionWidth, kSectionHeight};
constexpr geom::AABB kItemBounds{0.0, 0.0, kItemWidth, kItemHeight};

[[nodiscard]] geom::AffineMatrix2D sectionTransform(int order) {
    return geom::AffineMatrix2D::translation(0.0, -kSectionSpacing * order);
}

[[nodiscard]] geom::AffineMatrix2D itemTransform(int order) {
    // Items are nested under their section, so this is a section-local offset
    // (the section's own transform composes on top via the scene graph).
    return geom::AffineMatrix2D::translation(0.0, -kItemSpacing * (order + 1));
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

} // namespace

MenuDesigner::MenuDesigner(AppleUnifiedEngine& engine, std::string rootId)
    : engine_(engine), rootId_(std::move(rootId)) {
    // The menu root is a generic MenuSection container at world origin. We do not
    // track it in sections_ (it holds no SectionData); it exists only to parent
    // the real sections so the whole menu can be transformed/removed as a unit.
    auto added = engine_.addObject("root", rootId_, ObjectType::MenuSection,
                                   geom::AffineMatrix2D{}, kSectionBounds, 0);
    if (!added) {
        // The kernel uses std::expected, not exceptions; a failed root (e.g. a
        // duplicate rootId on this engine) leaves the construct inert. Record the
        // error and do NOT register intents on a broken construct — every mutating
        // method will short-circuit with this error instead.
        init_error_ = added.error();
        return;
    }
    registerIntents();
}

void MenuDesigner::registerIntents() {
    auto& intents = engine_.intents();

    {
        AssistantSchema s;
        s.name = "AddMenuSection";
        s.description = "Add a section to the menu";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"name", ParamType::String, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                const auto& name = std::get<std::string>(p.at("name"));
                auto r = addSection(id, name);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"added section " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "AddMenuItem";
        s.description = "Add an item to a menu section";
        s.params = {
            ParamSpec{"sectionId", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"name", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"priceCents", ParamType::Int, true, {}, 0.0, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& sectionId = std::get<std::string>(p.at("sectionId"));
                const auto& id = std::get<std::string>(p.at("id"));
                const auto& name = std::get<std::string>(p.at("name"));
                auto price = std::get<std::int64_t>(p.at("priceCents"));
                auto r = addItem(sectionId, id, name, price);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"added item " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "SetMenuItemPrice";
        s.description = "Set the price of a menu item";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"priceCents", ParamType::Int, true, {}, 0.0, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                auto price = std::get<std::int64_t>(p.at("priceCents"));
                auto r = setItemPrice(id, price);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"priced item " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "RenameMenuItem";
        s.description = "Rename a menu item";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"name", ParamType::String, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                const auto& name = std::get<std::string>(p.at("name"));
                auto r = renameItem(id, name);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"renamed item " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "MoveMenuItem";
        s.description = "Move a menu item to another section";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
            ParamSpec{"targetSectionId", ParamType::String, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                const auto& target = std::get<std::string>(p.at("targetSectionId"));
                auto r = moveItemToSection(id, target);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"moved item " + id, id};
            });
    }

    {
        AssistantSchema s;
        s.name = "RemoveMenuItem";
        s.description = "Remove a menu item";
        s.params = {
            ParamSpec{"id", ParamType::String, true, {}, {}, {}, {}},
        };
        (void)intents.registerSchema(
            std::move(s),
            [this](const ParamMap& p) -> std::expected<DispatchResult, std::string> {
                const auto& id = std::get<std::string>(p.at("id"));
                auto r = removeItem(id);
                if (!r) {
                    return std::unexpected(r.error());
                }
                return DispatchResult{"removed item " + id, id};
            });
    }
}

int MenuDesigner::itemsInSection(const std::string& sectionId) const {
    int count = 0;
    for (const auto& [id, data] : items_) {
        if (data.sectionId == sectionId) {
            ++count;
        }
    }
    return count;
}

std::expected<void, std::string> MenuDesigner::addSection(const std::string& id,
                                                          const std::string& name) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    if (sections_.contains(id)) {
        return std::unexpected("duplicate section id: " + id);
    }
    const int order = static_cast<int>(sections_.size());

    // (a) scene + spatial index
    auto added = engine_.addObject(rootId_, id, ObjectType::MenuSection,
                                   sectionTransform(order), kSectionBounds, order);
    if (!added) {
        return std::unexpected(added.error());
    }
    // (b) construct data
    sections_.emplace(id, SectionData{name, order});
    // (c) collaboration op
    engine_.collab().applyLocalOp(
        "menu.addSection", id,
        "{\"name\":" + jsonStr(name) + ",\"order\":" + std::to_string(order) + "}");
    // (d) audio cue
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectAdded);
    return {};
}

std::expected<void, std::string> MenuDesigner::addItem(const std::string& sectionId,
                                                       const std::string& id,
                                                       const std::string& name,
                                                       std::int64_t priceCents) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    if (!sections_.contains(sectionId)) {
        return std::unexpected("unknown section: " + sectionId);
    }
    if (items_.contains(id)) {
        return std::unexpected("duplicate item id: " + id);
    }
    const int order = itemsInSection(sectionId);

    auto added = engine_.addObject(sectionId, id, ObjectType::MenuItem,
                                   itemTransform(order), kItemBounds, order);
    if (!added) {
        return std::unexpected(added.error());
    }
    items_.emplace(id, ItemData{name, priceCents, sectionId, order});
    engine_.collab().applyLocalOp(
        "menu.addItem", id,
        "{\"sectionId\":" + jsonStr(sectionId) + ",\"name\":" + jsonStr(name) +
            ",\"priceCents\":" + std::to_string(priceCents) +
            ",\"order\":" + std::to_string(order) + "}");
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectAdded);
    return {};
}

std::expected<void, std::string> MenuDesigner::setItemPrice(const std::string& id,
                                                            std::int64_t priceCents) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    auto it = items_.find(id);
    if (it == items_.end()) {
        return std::unexpected("unknown item: " + id);
    }
    // No scene mutation: price is pure domain data. Still flow through collab and
    // an audio cue so the reconfiguration is replicated and audible.
    it->second.priceCents = priceCents;
    engine_.collab().applyLocalOp(
        "menu.setItemPrice", id,
        "{\"priceCents\":" + std::to_string(priceCents) + "}");
    engine_.synth().trigger(AppleAudio::SoundEvent::Reconfigured);
    return {};
}

std::expected<void, std::string> MenuDesigner::renameItem(const std::string& id,
                                                          const std::string& name) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    auto it = items_.find(id);
    if (it == items_.end()) {
        return std::unexpected("unknown item: " + id);
    }
    it->second.name = name;
    engine_.collab().applyLocalOp("menu.renameItem", id,
                                  "{\"name\":" + jsonStr(name) + "}");
    engine_.synth().trigger(AppleAudio::SoundEvent::Reconfigured);
    return {};
}

std::expected<void, std::string> MenuDesigner::moveItemToSection(
    const std::string& id, const std::string& targetSectionId) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    // FAIL FAST: validate everything BEFORE touching the engine. If the target is
    // unknown (or the item is missing), we return here without any removeObject,
    // so the item stays intact and hit-testable in its old spot.
    auto it = items_.find(id);
    if (it == items_.end()) {
        return std::unexpected("unknown item: " + id);
    }
    if (!sections_.contains(targetSectionId)) {
        return std::unexpected("unknown section: " + targetSectionId);
    }
    if (it->second.sectionId == targetSectionId) {
        return {}; // already there; no-op
    }

    // Snapshot the item's full prior state so we can restore it byte-for-byte if
    // the re-add under the target fails after we've already detached the node.
    const ItemData oldData = it->second;

    // Reparent = remove the node then re-add under the target section. The engine
    // has no reparent primitive, so the construct composes remove + add and keeps
    // its own ItemData intact (recomputing only order/transform).
    if (!engine_.removeObject(id)) {
        // Nothing was mutated (removeObject returned false), so the item is still
        // intact in items_ and the scene; surface the detach failure unchanged.
        return std::unexpected("failed to detach item: " + id);
    }
    // The item is still recorded in items_ under its old section (removeObject
    // only touched the scene), so this count excludes it and yields the next
    // free slot in the target section.
    const int order = itemsInSection(targetSectionId);
    auto added = engine_.addObject(targetSectionId, id, ObjectType::MenuItem,
                                   itemTransform(order), kItemBounds, order);
    if (!added) {
        // Re-add failed after we already detached the node. Attempt to RESTORE the
        // node under its OLD section at its OLD order/transform/zOrder so the move
        // is atomic from the caller's view (state unchanged, original error
        // returned). This path is unlikely given the fail-fast validation above.
        auto restored = engine_.addObject(oldData.sectionId, id, ObjectType::MenuItem,
                                          itemTransform(oldData.order), kItemBounds,
                                          oldData.order);
        if (restored) {
            // ItemData still holds the old section/order, so it is already correct.
            return std::unexpected(added.error());
        }
        // Restore also failed: the scene node is truly gone. Drop the now-orphaned
        // domain data and report the loss explicitly rather than leaving an item
        // that no longer has a scene node behind it.
        items_.erase(id);
        return std::unexpected("item lost during move: " + id +
                               " (re-add failed: " + added.error() +
                               "; restore failed: " + restored.error() + ")");
    }

    ItemData data = oldData;
    data.sectionId = targetSectionId;
    data.order = order;
    it->second = data;

    engine_.collab().applyLocalOp(
        "menu.moveItem", id,
        "{\"targetSectionId\":" + jsonStr(targetSectionId) +
            ",\"order\":" + std::to_string(order) + "}");
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectMoved);
    return {};
}

std::expected<void, std::string> MenuDesigner::removeItem(const std::string& id) {
    if (init_error_) {
        return std::unexpected(*init_error_);
    }
    if (!items_.contains(id)) {
        return std::unexpected("unknown item: " + id);
    }
    if (!engine_.removeObject(id)) {
        return std::unexpected("failed to remove item node: " + id);
    }
    items_.erase(id);
    engine_.collab().applyLocalOp("menu.removeItem", id, "{}");
    engine_.synth().trigger(AppleAudio::SoundEvent::ObjectRemoved);
    return {};
}

const MenuDesigner::ItemData* MenuDesigner::item(const std::string& id) const {
    auto it = items_.find(id);
    return it == items_.end() ? nullptr : &it->second;
}

const MenuDesigner::SectionData* MenuDesigner::section(const std::string& id) const {
    auto it = sections_.find(id);
    return it == sections_.end() ? nullptr : &it->second;
}

} // namespace AppleGraphics::constructs
