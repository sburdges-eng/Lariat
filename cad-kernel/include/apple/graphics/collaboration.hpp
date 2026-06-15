#pragma once
#include <cstdint>
#include <expected>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "apple/graphics/types.hpp"

namespace AppleGraphics {

// CollaborationManager — a simulated model of visionOS SharePlay spatial
// collaboration. Real SharePlay uses GroupActivities + a GroupSession, arranges
// remote participants as Spatial Personas via a SystemCoordinator template, and
// replicates state across peers. Here we model the same shape in C++ so the
// engine can host a multi-user co-editing session offline/deterministically.
//
// Two responsibilities:
//   1. Participants: a roster of session members, each placed in space (pose)
//      and optionally rendered as a Spatial Persona, arranged by a template.
//   2. Replicated op log: a SharePlay-compatible, idempotent op stream. Each op
//      carries a serializable JSON payload plus an (origin, seq) identity so
//      peers can dedupe replays — mirroring the existing Lariat sync op_id
//      idempotency model.
//
// Thread-safety: the manager owns a std::mutex and every public method locks it
// for its whole body. This models the collab-sync thread (receiving remote ops)
// running concurrently with the render thread (reading the roster / op log).
// Snapshot getters return copies so callers never hold references into locked
// state.

// How remote Spatial Personas are arranged around the local user.
enum class PersonaTemplate { Surround, Conversational, SideBySide };

// A session member. `pose` is the participant's position in the shared space;
// `isSpatialPersona` is true when the member is rendered as a full Spatial
// Persona (vs. a placeholder/spatial audio-only participant).
struct SpatialParticipant {
    std::string id;
    Vec3 pose;
    bool isSpatialPersona;
};

// A single replicated edit. `origin` is the participant/instance id that
// authored it; `seq` is that origin's per-origin monotonic counter. Together
// (origin, seq) is the idempotency key peers use to dedupe replays. `payloadJson`
// is the serializable, SharePlay-compatible body.
struct CollabOp {
    std::string origin;
    std::uint64_t seq;
    std::string opKind;
    std::string targetId;
    std::string payloadJson;
};

class CollaborationManager {
public:
    explicit CollaborationManager(std::string localId = "local");

    [[nodiscard]] const std::string& localId() const;

    // --- Participants -------------------------------------------------------

    // Adds a participant. Errors if `id` is already in the roster.
    std::expected<void, std::string> addParticipant(const std::string& id,
                                                     bool isSpatialPersona);

    // Removes `id` from the roster. Returns false if `id` is unknown.
    bool removeParticipant(const std::string& id);

    // Updates an existing participant's pose. Errors if `id` is unknown.
    std::expected<void, std::string> updateParticipantPose(const std::string& id,
                                                           const Vec3& pose);

    // Snapshot copy of the whole roster.
    [[nodiscard]] std::vector<SpatialParticipant> participants() const;

    // Snapshot copy of one participant, or nullopt if unknown.
    [[nodiscard]] std::optional<SpatialParticipant> participant(
        const std::string& id) const;

    // --- Templates ----------------------------------------------------------

    void setSpatialTemplate(PersonaTemplate t);
    [[nodiscard]] PersonaTemplate spatialTemplate() const;

    // --- Op log (SharePlay sync) -------------------------------------------

    // Authors a local op: origin = localId_, seq = next local monotonic value
    // (strictly increasing, starting at 1). Appends to the log, marks
    // (origin, seq) seen, and returns the authored op. Safe under concurrent
    // calls: each call gets a unique, strictly-increasing local seq.
    CollabOp applyLocalOp(const std::string& opKind, const std::string& targetId,
                          const std::string& payloadJson);

    // Applies a remote op idempotently by (origin, seq). If already seen,
    // returns false and does not append. Otherwise appends, marks it seen,
    // advances that origin's high-water mark, and returns true.
    bool receiveRemoteOp(const CollabOp& op);

    // Snapshot copy of the full op log, in append order.
    [[nodiscard]] std::vector<CollabOp> opLog() const;

    // Number of ops currently in the log.
    [[nodiscard]] std::size_t opCount() const;

private:
    // Composes the (origin, seq) idempotency key into a single string for the
    // seen-set. Caller must hold mutex_.
    [[nodiscard]] static std::string opKey(const std::string& origin,
                                           std::uint64_t seq);

    mutable std::mutex mutex_;
    std::string localId_;
    PersonaTemplate template_ = PersonaTemplate::Conversational;

    // Per-origin monotonic counter for ops we author locally.
    std::uint64_t localSeq_ = 0;

    // Roster, keyed by participant id for O(1) lookup/update/remove.
    std::unordered_map<std::string, SpatialParticipant> participants_;

    // Replicated op log, in append order.
    std::vector<CollabOp> opLog_;

    // (origin, seq) keys already applied — the dedupe set for idempotent replay.
    std::unordered_set<std::string> seen_;

    // Highest seq applied per origin (high-water mark) for replay reasoning.
    std::unordered_map<std::string, std::uint64_t> highWater_;
};

} // namespace AppleGraphics
