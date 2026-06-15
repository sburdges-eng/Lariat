#include "apple/graphics/collaboration.hpp"

#include <utility>

namespace AppleGraphics {

CollaborationManager::CollaborationManager(std::string localId)
    : localId_(std::move(localId)) {}

const std::string& CollaborationManager::localId() const {
    // localId_ is set once at construction and never mutated, but lock anyway to
    // keep the "every public method locks" contract uniform.
    std::lock_guard<std::mutex> lock(mutex_);
    return localId_;
}

std::expected<void, std::string> CollaborationManager::addParticipant(
    const std::string& id, bool isSpatialPersona) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (participants_.contains(id)) {
        return std::unexpected("participant already exists: " + id);
    }
    participants_.emplace(id, SpatialParticipant{id, Vec3{}, isSpatialPersona});
    return {};
}

bool CollaborationManager::removeParticipant(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    return participants_.erase(id) > 0;
}

std::expected<void, std::string> CollaborationManager::updateParticipantPose(
    const std::string& id, const Vec3& pose) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = participants_.find(id);
    if (it == participants_.end()) {
        return std::unexpected("unknown participant: " + id);
    }
    it->second.pose = pose;
    return {};
}

std::vector<SpatialParticipant> CollaborationManager::participants() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<SpatialParticipant> out;
    out.reserve(participants_.size());
    for (const auto& [id, p] : participants_) {
        out.push_back(p);
    }
    return out;
}

std::optional<SpatialParticipant> CollaborationManager::participant(
    const std::string& id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = participants_.find(id);
    if (it == participants_.end()) {
        return std::nullopt;
    }
    return it->second;
}

void CollaborationManager::setSpatialTemplate(PersonaTemplate t) {
    std::lock_guard<std::mutex> lock(mutex_);
    template_ = t;
}

PersonaTemplate CollaborationManager::spatialTemplate() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return template_;
}

std::string CollaborationManager::opKey(const std::string& origin,
                                        std::uint64_t seq) {
    // '#' is not part of an origin id in practice; the seq suffix makes the key
    // unambiguous regardless. Format: "<origin>#<seq>".
    return origin + '#' + std::to_string(seq);
}

CollabOp CollaborationManager::applyLocalOp(const std::string& opKind,
                                            const std::string& targetId,
                                            const std::string& payloadJson) {
    std::lock_guard<std::mutex> lock(mutex_);
    const std::uint64_t seq = ++localSeq_;  // strictly increasing, starts at 1
    CollabOp op{localId_, seq, opKind, targetId, payloadJson};
    seen_.insert(opKey(op.origin, op.seq));
    highWater_[op.origin] = seq;
    opLog_.push_back(op);
    return op;
}

bool CollaborationManager::receiveRemoteOp(const CollabOp& op) {
    std::lock_guard<std::mutex> lock(mutex_);
    const std::string key = opKey(op.origin, op.seq);
    if (seen_.contains(key)) {
        return false;  // idempotent replay: already applied
    }
    seen_.insert(key);
    auto& hw = highWater_[op.origin];
    if (op.seq > hw) {
        hw = op.seq;
    }
    opLog_.push_back(op);
    return true;
}

std::vector<CollabOp> CollaborationManager::opLog() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return opLog_;
}

std::size_t CollaborationManager::opCount() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return opLog_.size();
}

} // namespace AppleGraphics
