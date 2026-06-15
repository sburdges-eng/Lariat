#pragma once
#include <cstdint>
#include <string>

namespace AppleAudio {

// AudioSessionManager — a simulated model of an Apple audio session's route
// handling. Real Apple platforms surface route changes (e.g. headphones plugged
// in, output switched to AirPods) via AVAudioSession route-change notifications;
// here we model just the observable shape: a current route string and a change
// counter, updated when the host reports a route change.
//
// Not thread-safe on its own: it is owned by the engine, which serializes access
// through its own mutex.
class AudioSessionManager {
public:
    AudioSessionManager() = default;

    // Records a route change: stores `route` as the current route, increments the
    // route-change counter, and logs one line.
    void handleRouteChange(const std::string& route);

    [[nodiscard]] const std::string& currentRoute() const;
    [[nodiscard]] std::uint64_t routeChangeCount() const;

private:
    std::string currentRoute_;
    std::uint64_t routeChangeCount_ = 0;
};

} // namespace AppleAudio
