#include <gtest/gtest.h>

#include <cmath>
#include <vector>

#include "apple/audio/audio_session.hpp"
#include "apple/audio/procedural_synth.hpp"
#include "apple/graphics/engine.hpp"
#include "apple/graphics/types.hpp"

namespace {

using AppleAudio::AudioSessionManager;
using AppleAudio::ProceduralSynthesizer;
using AppleAudio::SoundEvent;
using AppleGraphics::AppleUnifiedEngine;
using AppleGraphics::ObjectType;
namespace geom = floorplan::geom;

constexpr geom::AABB kUnitBox{-1.0, -1.0, 1.0, 1.0};

TEST(ProceduralSynth, SetFrequencyRoundTrips) {
    ProceduralSynthesizer synth;
    EXPECT_FLOAT_EQ(synth.frequency(), 0.0f);
    synth.setFrequency(123.0f);
    EXPECT_FLOAT_EQ(synth.frequency(), 123.0f);
}

TEST(ProceduralSynth, TriggerSetsMappedFrequencyAndCounts) {
    ProceduralSynthesizer synth;
    const SoundEvent events[] = {
        SoundEvent::ObjectAdded, SoundEvent::ObjectMoved,
        SoundEvent::ObjectRemoved, SoundEvent::Reconfigured,
        SoundEvent::Selected,
    };

    std::uint64_t expectedTotal = 0;
    for (SoundEvent e : events) {
        synth.trigger(e);
        ++expectedTotal;
        EXPECT_FLOAT_EQ(synth.frequency(), ProceduralSynthesizer::frequencyFor(e));
        EXPECT_EQ(synth.triggerCount(e), 1u);
        EXPECT_EQ(synth.totalTriggers(), expectedTotal);
    }

    // Re-trigger one event: its per-event count and the total both advance.
    synth.trigger(SoundEvent::ObjectAdded);
    EXPECT_EQ(synth.triggerCount(SoundEvent::ObjectAdded), 2u);
    EXPECT_EQ(synth.totalTriggers(), expectedTotal + 1);
}

TEST(ProceduralSynth, DistinctEventsMapToDistinctFrequencies) {
    const float freqs[] = {
        ProceduralSynthesizer::frequencyFor(SoundEvent::ObjectAdded),
        ProceduralSynthesizer::frequencyFor(SoundEvent::ObjectMoved),
        ProceduralSynthesizer::frequencyFor(SoundEvent::ObjectRemoved),
        ProceduralSynthesizer::frequencyFor(SoundEvent::Reconfigured),
        ProceduralSynthesizer::frequencyFor(SoundEvent::Selected),
    };
    for (std::size_t i = 0; i < std::size(freqs); ++i) {
        for (std::size_t j = i + 1; j < std::size(freqs); ++j) {
            EXPECT_NE(freqs[i], freqs[j]);
        }
    }
}

TEST(ProceduralSynth, ProcessOutputIsBounded) {
    ProceduralSynthesizer synth;
    synth.setFrequency(440.0f);
    constexpr std::uint32_t kN = 1024;
    std::vector<float> buf(kN, 99.0f);
    synth.process(buf.data(), kN);
    for (float s : buf) {
        EXPECT_GE(s, -1.0f);
        EXPECT_LE(s, 1.0f);
    }
}

TEST(ProceduralSynth, PhaseIsContinuousAcrossCalls) {
    constexpr std::uint32_t kN = 512;
    constexpr float kFreq = 440.0f;

    // Two consecutive process() calls of N frames.
    ProceduralSynthesizer split;
    split.setFrequency(kFreq);
    std::vector<float> a(kN);
    std::vector<float> b(kN);
    split.process(a.data(), kN);
    split.process(b.data(), kN);

    // A single process() of 2N frames.
    ProceduralSynthesizer whole;
    whole.setFrequency(kFreq);
    std::vector<float> full(2 * kN);
    whole.process(full.data(), 2 * kN);

    for (std::uint32_t i = 0; i < kN; ++i) {
        EXPECT_NEAR(a[i], full[i], 1e-5f);
        EXPECT_NEAR(b[i], full[kN + i], 1e-5f);
    }
}

TEST(ProceduralSynth, ZeroFrequencyProducesSilence) {
    ProceduralSynthesizer synth;
    synth.setFrequency(0.0f);
    constexpr std::uint32_t kN = 256;
    std::vector<float> buf(kN, 7.0f);
    synth.process(buf.data(), kN);
    for (float s : buf) {
        EXPECT_FLOAT_EQ(s, 0.0f);
    }
    // Phase must not advance at frequency 0.
    EXPECT_DOUBLE_EQ(synth.phase(), 0.0);
}

TEST(ProceduralSynth, NullBufferAndZeroFramesAreNoOps) {
    ProceduralSynthesizer synth;
    synth.setFrequency(440.0f);
    // Null buffer: no crash, phase untouched (ASan/UBSan clean).
    synth.process(nullptr, 128);
    EXPECT_DOUBLE_EQ(synth.phase(), 0.0);

    // Zero frames: no crash, phase untouched.
    std::vector<float> buf(4, 1.0f);
    synth.process(buf.data(), 0);
    EXPECT_DOUBLE_EQ(synth.phase(), 0.0);
    EXPECT_FLOAT_EQ(buf[0], 1.0f); // buffer left untouched
}

TEST(AudioSession, HandleRouteChangeUpdatesStateAndCount) {
    AudioSessionManager session;
    EXPECT_EQ(session.currentRoute(), "");
    EXPECT_EQ(session.routeChangeCount(), 0u);

    session.handleRouteChange("Speaker");
    EXPECT_EQ(session.currentRoute(), "Speaker");
    EXPECT_EQ(session.routeChangeCount(), 1u);

    session.handleRouteChange("Headphones");
    EXPECT_EQ(session.currentRoute(), "Headphones");
    EXPECT_EQ(session.routeChangeCount(), 2u);
}

TEST(EngineAudioWiring, SynthAndAudioSessionAreUsableViaEngine) {
    AppleUnifiedEngine engine;

    // Drive procedural audio through the engine's synth accessor.
    engine.synth().trigger(SoundEvent::Selected);
    EXPECT_FLOAT_EQ(engine.synth().frequency(),
                    ProceduralSynthesizer::frequencyFor(SoundEvent::Selected));
    EXPECT_EQ(engine.synth().triggerCount(SoundEvent::Selected), 1u);
    EXPECT_EQ(engine.synth().totalTriggers(), 1u);

    // A real interaction can pair with a trigger.
    ASSERT_TRUE(engine.addObject("root", "a", ObjectType::Table,
                                 geom::AffineMatrix2D{}, kUnitBox, 0)
                    .has_value());
    engine.synth().trigger(SoundEvent::ObjectAdded);
    EXPECT_EQ(engine.synth().totalTriggers(), 2u);

    // Route change through the engine's audio session accessor.
    engine.audioSession().handleRouteChange("AirPods");
    EXPECT_EQ(engine.audioSession().currentRoute(), "AirPods");
    EXPECT_EQ(engine.audioSession().routeChangeCount(), 1u);
}

} // namespace
