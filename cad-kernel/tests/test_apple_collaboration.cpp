#include <gtest/gtest.h>

#include <cstdint>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "apple/graphics/collaboration.hpp"
#include "apple/graphics/engine.hpp"

namespace {

using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::CollabOp;
using AppleGraphics::CollaborationManager;
using AppleGraphics::PersonaTemplate;
using AppleGraphics::SpatialParticipant;
using AppleGraphics::Vec3;

Vec3 makePose(float x, float y, float z) {
#if APPLE_GRAPHICS_HAVE_SIMD
    return simd_make_float3(x, y, z);
#else
    return Vec3{x, y, z};
#endif
}

// --- Participants -----------------------------------------------------------

TEST(CollaborationParticipants, AddAndQuery) {
    CollaborationManager mgr;
    ASSERT_TRUE(mgr.addParticipant("alice", true).has_value());
    ASSERT_TRUE(mgr.addParticipant("bob", false).has_value());

    auto alice = mgr.participant("alice");
    ASSERT_TRUE(alice.has_value());
    EXPECT_EQ(alice->id, "alice");
    EXPECT_TRUE(alice->isSpatialPersona);

    auto bob = mgr.participant("bob");
    ASSERT_TRUE(bob.has_value());
    EXPECT_FALSE(bob->isSpatialPersona);

    EXPECT_FALSE(mgr.participant("carol").has_value());

    auto all = mgr.participants();
    EXPECT_EQ(all.size(), 2u);
}

TEST(CollaborationParticipants, DuplicateAddIsUnexpected) {
    CollaborationManager mgr;
    ASSERT_TRUE(mgr.addParticipant("alice", true).has_value());
    auto dup = mgr.addParticipant("alice", false);
    EXPECT_FALSE(dup.has_value());
    // Original entry is untouched.
    auto alice = mgr.participant("alice");
    ASSERT_TRUE(alice.has_value());
    EXPECT_TRUE(alice->isSpatialPersona);
}

TEST(CollaborationParticipants, Remove) {
    CollaborationManager mgr;
    ASSERT_TRUE(mgr.addParticipant("alice", true).has_value());
    EXPECT_TRUE(mgr.removeParticipant("alice"));
    EXPECT_FALSE(mgr.participant("alice").has_value());
    EXPECT_FALSE(mgr.removeParticipant("alice"));  // already gone
    EXPECT_FALSE(mgr.removeParticipant("nobody"));
}

TEST(CollaborationParticipants, UpdatePose) {
    CollaborationManager mgr;
    ASSERT_TRUE(mgr.addParticipant("alice", true).has_value());
    ASSERT_TRUE(mgr.updateParticipantPose("alice", makePose(1.0f, 2.0f, 3.0f))
                    .has_value());
    auto alice = mgr.participant("alice");
    ASSERT_TRUE(alice.has_value());
    EXPECT_FLOAT_EQ(alice->pose.x, 1.0f);
    EXPECT_FLOAT_EQ(alice->pose.y, 2.0f);
    EXPECT_FLOAT_EQ(alice->pose.z, 3.0f);
}

TEST(CollaborationParticipants, UpdatePoseUnknownIsUnexpected) {
    CollaborationManager mgr;
    auto r = mgr.updateParticipantPose("ghost", makePose(0, 0, 0));
    EXPECT_FALSE(r.has_value());
}

// --- Templates --------------------------------------------------------------

TEST(CollaborationTemplate, DefaultIsConversational) {
    CollaborationManager mgr;
    EXPECT_EQ(mgr.spatialTemplate(), PersonaTemplate::Conversational);
}

TEST(CollaborationTemplate, RoundTrip) {
    CollaborationManager mgr;
    mgr.setSpatialTemplate(PersonaTemplate::Surround);
    EXPECT_EQ(mgr.spatialTemplate(), PersonaTemplate::Surround);
    mgr.setSpatialTemplate(PersonaTemplate::SideBySide);
    EXPECT_EQ(mgr.spatialTemplate(), PersonaTemplate::SideBySide);
}

// --- Op log -----------------------------------------------------------------

TEST(CollaborationOps, LocalIdDefault) {
    CollaborationManager mgr;
    EXPECT_EQ(mgr.localId(), "local");
    CollaborationManager named("host-7");
    EXPECT_EQ(named.localId(), "host-7");
}

TEST(CollaborationOps, ApplyLocalOpAssignsIncreasingSeq) {
    CollaborationManager mgr("host");
    auto op1 = mgr.applyLocalOp("move", "T1", R"({"x":1})");
    auto op2 = mgr.applyLocalOp("move", "T2", R"({"x":2})");

    EXPECT_EQ(op1.origin, "host");
    EXPECT_EQ(op1.seq, 1u);
    EXPECT_EQ(op1.opKind, "move");
    EXPECT_EQ(op1.targetId, "T1");
    EXPECT_EQ(op1.payloadJson, R"({"x":1})");

    EXPECT_EQ(op2.origin, "host");
    EXPECT_EQ(op2.seq, 2u);

    EXPECT_EQ(mgr.opCount(), 2u);
    auto log = mgr.opLog();
    ASSERT_EQ(log.size(), 2u);
    EXPECT_EQ(log[0].seq, 1u);
    EXPECT_EQ(log[1].seq, 2u);
}

TEST(CollaborationOps, ReceiveRemoteOpIsIdempotent) {
    CollaborationManager mgr("local");

    CollabOp remote{"peerA", 1, "add", "T9", R"({"v":1})"};
    EXPECT_TRUE(mgr.receiveRemoteOp(remote));  // new -> appended
    EXPECT_EQ(mgr.opCount(), 1u);

    // Same (origin, seq) replayed -> ignored.
    EXPECT_FALSE(mgr.receiveRemoteOp(remote));
    EXPECT_EQ(mgr.opCount(), 1u);

    // Same again, even with a different payload (idempotency is keyed on
    // (origin, seq), not contents).
    CollabOp replayDifferentPayload{"peerA", 1, "add", "T9", R"({"v":999})"};
    EXPECT_FALSE(mgr.receiveRemoteOp(replayDifferentPayload));
    EXPECT_EQ(mgr.opCount(), 1u);

    // A new seq from the same origin -> appended.
    CollabOp remote2{"peerA", 2, "move", "T9", R"({"v":2})"};
    EXPECT_TRUE(mgr.receiveRemoteOp(remote2));
    EXPECT_EQ(mgr.opCount(), 2u);
}

TEST(CollaborationOps, LocalAndRemoteSameSeqDoNotCollide) {
    // Local origin "local" seq 1 and remote origin "peerA" seq 1 are distinct
    // keys, so both apply.
    CollaborationManager mgr("local");
    auto local = mgr.applyLocalOp("k", "t", "{}");
    EXPECT_EQ(local.origin, "local");
    EXPECT_EQ(local.seq, 1u);

    CollabOp remote{"peerA", 1, "k", "t", "{}"};
    EXPECT_TRUE(mgr.receiveRemoteOp(remote));
    EXPECT_EQ(mgr.opCount(), 2u);
}

// --- Concurrency ------------------------------------------------------------

TEST(CollaborationConcurrency, ApplyLocalOpFromManyThreads) {
    CollaborationManager mgr("host");
    constexpr int kThreads = 8;
    constexpr int kPerThread = 500;

    std::vector<std::vector<std::uint64_t>> seqsByThread(kThreads);
    std::vector<std::thread> workers;
    workers.reserve(kThreads);

    for (int t = 0; t < kThreads; ++t) {
        workers.emplace_back([&, t]() {
            for (int i = 0; i < kPerThread; ++i) {
                auto op = mgr.applyLocalOp("op", "target", "{}");
                seqsByThread[t].push_back(op.seq);
            }
        });
    }
    for (auto& w : workers) {
        w.join();
    }

    EXPECT_EQ(mgr.opCount(),
              static_cast<std::size_t>(kThreads) * kPerThread);

    // Every returned local seq is unique.
    std::set<std::uint64_t> uniqueSeqs;
    for (const auto& perThread : seqsByThread) {
        for (auto s : perThread) {
            uniqueSeqs.insert(s);
        }
    }
    EXPECT_EQ(uniqueSeqs.size(),
              static_cast<std::size_t>(kThreads) * kPerThread);

    // The op log is internally consistent (all local origin, all seqs unique).
    auto log = mgr.opLog();
    std::set<std::uint64_t> logSeqs;
    for (const auto& op : log) {
        EXPECT_EQ(op.origin, "host");
        logSeqs.insert(op.seq);
    }
    EXPECT_EQ(logSeqs.size(),
              static_cast<std::size_t>(kThreads) * kPerThread);
}

// --- Engine wiring ----------------------------------------------------------

TEST(CollaborationEngine, EngineExposesCollab) {
    AppleUnifiedEngine engine;
    auto& collab = engine.collab();
    EXPECT_EQ(collab.localId(), "local");
    auto op = collab.applyLocalOp("k", "t", "{}");
    EXPECT_EQ(op.seq, 1u);
    EXPECT_EQ(engine.collab().opCount(), 1u);
}

} // namespace
