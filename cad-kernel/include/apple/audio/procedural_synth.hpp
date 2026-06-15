#pragma once
#include <array>
#include <cstdint>

namespace AppleAudio {

// ProceduralSynthesizer — a simulated procedural audio engine. Real Apple audio
// would route through AVFoundation / AVAudioEngine with an AVAudioSourceNode
// rendering callback; here we model the same shape in pure C++ so engine/scene
// interactions can drive deterministic, unit-testable procedural audio offline.
//
// Each user-facing interaction (a SoundEvent) maps to a distinct tone. Triggering
// an event selects its frequency and bumps a per-event counter; process() renders
// a phase-continuous sine at the current frequency. There is no real device I/O.
//
// Not thread-safe on its own: it is owned by the engine, which serializes access
// through its own mutex (matching how the engine guards its other members).
enum class SoundEvent {
    ObjectAdded,
    ObjectMoved,
    ObjectRemoved,
    Reconfigured,
    Selected,
};

class ProceduralSynthesizer {
public:
    // Number of distinct SoundEvent values; sizes the per-event counter table.
    static constexpr std::size_t kEventCount = 5;

    explicit ProceduralSynthesizer(float sampleRate = 44100.0f);

    // Sets/reads the current oscillator frequency in Hz. A frequency of 0 yields
    // silence from process() (a constant 0 signal).
    void setFrequency(float hz);
    [[nodiscard]] float frequency() const;

    // Maps `e` to its distinct tone, sets the current frequency to that tone,
    // increments the per-event trigger counter and the running total. This is the
    // hook scene interactions call to "play" procedural audio for an event.
    void trigger(SoundEvent e);

    // The fixed tone (Hz) associated with `e`.
    [[nodiscard]] static float frequencyFor(SoundEvent e);

    // How many times `e` has been triggered, and the total across all events.
    [[nodiscard]] std::uint64_t triggerCount(SoundEvent e) const;
    [[nodiscard]] std::uint64_t totalTriggers() const;

    // Fills `buffer` with `frameCount` samples of a sine at the current
    // frequency, advancing the internal phase so consecutive calls are
    // phase-continuous (the phase is never reset by process()). Output is bounded
    // to [-1, 1]. At frequency 0 the output is a constant 0. A null buffer or a
    // 0 frame count is a safe no-op (the phase is not advanced).
    void process(float* buffer, std::uint32_t frameCount);

    // Current oscillator phase in radians, wrapped to [0, 2*pi). Exposed for
    // tests that assert phase continuity across calls.
    [[nodiscard]] double phase() const;

private:
    [[nodiscard]] static std::size_t indexOf(SoundEvent e);

    float sampleRate_;
    float frequency_ = 0.0f;
    double phase_ = 0.0; // radians, in [0, 2*pi)
    std::array<std::uint64_t, kEventCount> triggerCounts_{};
    std::uint64_t totalTriggers_ = 0;
};

} // namespace AppleAudio
