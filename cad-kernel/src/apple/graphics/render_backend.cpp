#include "apple/graphics/render_backend.hpp"

#include <iostream>

namespace AppleGraphics {

namespace {

std::size_t countSubtree(const core::SceneNode& node) {
    std::size_t total = 1;
    for (const auto& child : node.children()) {
        total += countSubtree(*child);
    }
    return total;
}

} // namespace

void NullRenderBackend::renderFrame(const core::SceneNode& root) {
    ++frame_count_;
    if (verbose_) {
        std::cout << "[NullRenderBackend] frame " << frame_count_ << " root='"
                  << root.getId() << "' nodes=" << countSubtree(root) << '\n';
    }
}

} // namespace AppleGraphics
