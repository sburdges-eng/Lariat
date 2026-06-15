#pragma once
#include <cstdint>

#include "core/scene_graph.hpp" // floorplan::core::SceneNode

namespace AppleGraphics {

namespace core = floorplan::core;

// Abstract render boundary. The engine drives a backend once per update(); the
// backend walks the scene graph and produces a frame however it sees fit.
//
// A platform backend (not built in T2) would live behind a guard such as:
//   #if defined(__APPLE__) && __has_include(<Metal/Metal.hpp>)
//   class MetalRenderBackend : public RenderBackend { ... };
//   #endif
// using metal-cpp's NS::TransferPtr for ownership of MTL objects. We add no
// metal-cpp dependency here; this is a documentation note only.
class RenderBackend {
public:
    virtual ~RenderBackend() = default;

    virtual void renderFrame(const core::SceneNode& root) = 0;
    [[nodiscard]] virtual std::uint64_t frameCount() const = 0;
};

// Headless backend used for tests and offline drives. Counts frames and, when
// verbose, logs a one-line summary per frame to std::cout. Quiet by default.
class NullRenderBackend : public RenderBackend {
public:
    explicit NullRenderBackend(bool verbose = false) : verbose_(verbose) {}

    void renderFrame(const core::SceneNode& root) override;
    [[nodiscard]] std::uint64_t frameCount() const override { return frame_count_; }

private:
    std::uint64_t frame_count_ = 0;
    bool verbose_ = false;
};

} // namespace AppleGraphics
