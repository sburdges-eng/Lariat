#include "apple/graphics/scene_object.hpp"

namespace AppleGraphics {

std::uint32_t ObjectStore::add(const std::string& id, ObjectMeta meta) {
    // If the id already exists, drop its old handle mapping first.
    if (auto it = by_id_.find(id); it != by_id_.end()) {
        handle_to_id_.erase(it->second.handle);
    }
    const std::uint32_t handle = next_handle_++;
    meta.handle = handle;
    by_id_[id] = meta;
    handle_to_id_[handle] = id;
    return handle;
}

bool ObjectStore::remove(const std::string& id) {
    auto it = by_id_.find(id);
    if (it == by_id_.end()) {
        return false;
    }
    handle_to_id_.erase(it->second.handle);
    by_id_.erase(it);
    return true;
}

const ObjectMeta* ObjectStore::find(const std::string& id) const {
    auto it = by_id_.find(id);
    return it == by_id_.end() ? nullptr : &it->second;
}

ObjectMeta* ObjectStore::find(const std::string& id) {
    auto it = by_id_.find(id);
    return it == by_id_.end() ? nullptr : &it->second;
}

const std::string* ObjectStore::idForHandle(std::uint32_t handle) const {
    auto it = handle_to_id_.find(handle);
    return it == handle_to_id_.end() ? nullptr : &it->second;
}

} // namespace AppleGraphics
