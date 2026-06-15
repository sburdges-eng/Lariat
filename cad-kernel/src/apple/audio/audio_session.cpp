#include "apple/audio/audio_session.hpp"

#include <iostream>

namespace AppleAudio {

void AudioSessionManager::handleRouteChange(const std::string& route) {
    currentRoute_ = route;
    ++routeChangeCount_;
    std::cout << "[AppleAudio] route change -> " << currentRoute_ << "\n";
}

const std::string& AudioSessionManager::currentRoute() const {
    return currentRoute_;
}

std::uint64_t AudioSessionManager::routeChangeCount() const {
    return routeChangeCount_;
}

} // namespace AppleAudio
