#include "apple/audio/procedural_synth.hpp"

#include <cmath>
#include <iostream>

namespace AppleAudio {

namespace {

constexpr double kTwoPi = 2.0 * M_PI;

const char* nameOf(SoundEvent e) {
    switch (e) {
        case SoundEvent::ObjectAdded:   return "ObjectAdded";
        case SoundEvent::ObjectMoved:   return "ObjectMoved";
        case SoundEvent::ObjectRemoved: return "ObjectRemoved";
        case SoundEvent::Reconfigured:  return "Reconfigured";
        case SoundEvent::Selected:      return "Selected";
    }
    return "Unknown";
}

} // namespace

ProceduralSynthesizer::ProceduralSynthesizer(float sampleRate)
    : sampleRate_(sampleRate > 0.0f ? sampleRate : 44100.0f) {}

void ProceduralSynthesizer::setFrequency(float hz) {
    frequency_ = hz < 0.0f ? 0.0f : hz;
}

float ProceduralSynthesizer::frequency() const {
    return frequency_;
}

float ProceduralSynthesizer::frequencyFor(SoundEvent e) {
    // Fixed event->tone table. Each event has a distinct frequency so audio cues
    // are distinguishable.
    switch (e) {
        case SoundEvent::ObjectAdded:   return 440.0f;
        case SoundEvent::ObjectMoved:   return 330.0f;
        case SoundEvent::ObjectRemoved: return 220.0f;
        case SoundEvent::Reconfigured:  return 550.0f;
        case SoundEvent::Selected:      return 660.0f;
    }
    return 0.0f;
}

std::size_t ProceduralSynthesizer::indexOf(SoundEvent e) {
    return static_cast<std::size_t>(e);
}

void ProceduralSynthesizer::trigger(SoundEvent e) {
    frequency_ = frequencyFor(e);
    ++triggerCounts_[indexOf(e)];
    ++totalTriggers_;
    std::cout << "[AppleAudio] trigger " << nameOf(e) << " @ " << frequency_
              << " Hz\n";
}

std::uint64_t ProceduralSynthesizer::triggerCount(SoundEvent e) const {
    return triggerCounts_[indexOf(e)];
}

std::uint64_t ProceduralSynthesizer::totalTriggers() const {
    return totalTriggers_;
}

void ProceduralSynthesizer::process(float* buffer, std::uint32_t frameCount) {
    if (buffer == nullptr || frameCount == 0) {
        return; // safe no-op; phase is left untouched
    }

    // At frequency 0 the output is constant 0 and the phase does not advance.
    if (frequency_ <= 0.0f) {
        for (std::uint32_t i = 0; i < frameCount; ++i) {
            buffer[i] = 0.0f;
        }
        return;
    }

    const double phaseStep = kTwoPi * static_cast<double>(frequency_) /
                             static_cast<double>(sampleRate_);
    for (std::uint32_t i = 0; i < frameCount; ++i) {
        const double s = std::sin(phase_);
        // std::sin is already in [-1, 1]; clamp defensively against rounding.
        buffer[i] = static_cast<float>(s < -1.0 ? -1.0 : (s > 1.0 ? 1.0 : s));
        phase_ += phaseStep;
        if (phase_ >= kTwoPi) {
            phase_ = std::fmod(phase_, kTwoPi);
        }
    }
}

double ProceduralSynthesizer::phase() const {
    return phase_;
}

} // namespace AppleAudio
