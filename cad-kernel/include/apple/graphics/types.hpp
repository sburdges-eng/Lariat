#pragma once
#include "geom/boolean_ops.hpp" // floorplan::geom::Vertex2D

// The SIMD boundary types: on Apple platforms with <simd/simd.h> available we
// use the native vector types so the Metal/render boundary can pass them through
// without conversion. This header must be included at global scope (it cannot
// live inside a namespace), so the guard lives here above the namespace.
#if defined(__APPLE__) && __has_include(<simd/simd.h>)
#define APPLE_GRAPHICS_HAVE_SIMD 1
#include <simd/simd.h>
#else
#define APPLE_GRAPHICS_HAVE_SIMD 0
#endif

namespace AppleGraphics {

// Full object taxonomy for the unified engine. Later tasks (constructs,
// collaboration, audio) reuse these tags; T2 only exercises a subset.
enum class ObjectType {
    Root,
    MenuSection,
    MenuItem,
    Table,
    Channel,
    Monitor,
    Instrument,
    Rigging
};

// SIMD boundary aliases. Native simd vectors on Apple; portable PODs with the
// same component layout elsewhere. (Vec3 is for collaboration cursors in a
// later task; just defined here.)
#if APPLE_GRAPHICS_HAVE_SIMD
using Vec2 = simd_float2;
using Vec3 = simd_float3;
#else
struct Vec2 {
    float x, y;
};
struct Vec3 {
    float x, y, z;
};
#endif

// Converters between the engine's double-precision geometry kernel and the
// single-precision render boundary. Vec3 is defined for collaboration/cursor
// work in a later task; only Vec2 converters are needed in T2.
[[nodiscard]] inline floorplan::geom::Vertex2D toVertex2D(const Vec2& v) {
    return floorplan::geom::Vertex2D{static_cast<double>(v.x), static_cast<double>(v.y)};
}

[[nodiscard]] inline Vec2 toVec2(const floorplan::geom::Vertex2D& v) {
#if APPLE_GRAPHICS_HAVE_SIMD
    return simd_make_float2(static_cast<float>(v.x), static_cast<float>(v.y));
#else
    return Vec2{static_cast<float>(v.x), static_cast<float>(v.y)};
#endif
}

} // namespace AppleGraphics
