# Apple Unified Engine (cad-kernel)

## Overview

The **Apple Unified Engine** is a graphics + interaction layer added on top of the
existing `floorplan::` geometry kernel. The kernel provides the deterministic,
double-precision math (scene graph, quadtree spatial index, affine transforms,
bounding volumes, seating/pathfinding ops); the Apple layer composes those
primitives into a single live, multi-user, audible engine plus three
*reconfigurable constructs* that turn the same engine into three different domain
tools:

- **MenuDesigner** — a reconfigurable menu (sections → items).
- **FloorPlan** — a reconfigurable dining-room layout (tables).
- **StageSetup** — a reconfigurable stage plot (channels, monitors, instruments,
  rigging, channel↔monitor mixes).

All three drive the *same* `AppleUnifiedEngine` instance; they differ only in the
domain data they own and the Assistant Schemas they register.

A standalone end-to-end demo (`apple_demo`) exercises the whole stack through the
public API; see **Build & run** below.

## Component map

| Component | Header | Responsibility |
|-----------|--------|----------------|
| `AppleUnifiedEngine` | `apple/graphics/engine.hpp` | Owns the scene root, object store, quadtree, render backend, intents bridge, collaboration manager, synth, and audio session. Serialises mutation behind an internal mutex. |
| `core::SceneNode` + `geom::Quadtree` | `core/scene_graph.hpp`, `geom/quadtree.hpp` | Scene hierarchy and the spatial index that backs `hitTest`. World AABBs are recomputed from local bounds through each node's global transform. |
| `ObjectStore` | `apple/graphics/scene_object.hpp` | Scene metadata + geometry per object id (kept free of domain payloads — constructs own their own data maps). |
| `AppIntentsBridge` | `apple/graphics/intents_bridge.hpp` | Simulated Apple "Assistant Schemas" (App Intents). Declares schemas, validates a `ParamMap` against each `ParamSpec`, runs the handler, and donates a one-line interaction. Synchronous; no intent queue. |
| `CollaborationManager` | `apple/graphics/collaboration.hpp` | Simulated SharePlay: a Spatial Persona roster arranged by a `PersonaTemplate`, plus an idempotent `(origin, seq)` op log mirroring Lariat's sync `op_id` model. Independently thread-safe. |
| `ProceduralSynthesizer` + `AudioSessionManager` | `apple/audio/*.hpp` | Simulated AVFoundation-style procedural audio: each interaction triggers a distinct `SoundEvent` tone; the session manager tracks route changes. |
| `RenderBackend` / `NullRenderBackend` | `apple/graphics/render_backend.hpp` | Abstract render boundary driven once per `update()`. `NullRenderBackend` is the headless default; a `MetalRenderBackend` is described only as a guarded stub (see Deviations). |

## The construct pattern

Each construct (`MenuDesigner`, `FloorPlan`, `StageSetup`) follows the same shape:

1. **`ctor(AppleUnifiedEngine& engine, rootId)`** — holds a non-owning reference to
   the engine, creates a single root node (`"menu"` / `"floor"` / `"stage"`) under
   the engine `"root"`, and calls `registerIntents()`.
2. **`registerIntents()`** — registers every Assistant Schema the construct exposes
   on the *shared* `engine.intents()`. Each handler parses a `ParamMap` and forwards
   to the matching typed method.
3. **Four-step mutation flow** — every mutating method runs the same sequence:
   1. `engine.addObject / moveObject / removeObject` (scene graph + spatial index),
   2. update the construct's own domain data maps,
   3. `engine.collab().applyLocalOp("<root>.<verb>", id, payloadJson)` (replicate),
   4. `engine.synth().trigger(<SoundEvent>)` (procedural audio cue).
4. **`init_error_` guard** — set iff the constructor's root `addObject` failed
   (e.g. a duplicate root id on the same engine). When set, the construct is inert:
   it registers no intents and every mutating method returns the same error.
   Surfaced via `initError()`.
5. **Remove + re-add-with-restore for structural changes** — the engine has no
   primitive to mutate a node's *bounds* or to reparent. So structural edits are
   composed: `FloorPlan::resizeTable` does `removeObject` + `addObject` at the same
   current transform with new bounds (restoring the old bounds on re-add failure),
   and `MenuDesigner::moveItemToSection` snapshots/restores `ItemData` across a
   reparent. Domain data is always preserved.

## Deviations & simulations (honest accounting)

This module models the *shape* of several Apple frameworks without depending on any
Apple SDK. The following are deliberate deviations and simulations:

- **Namespaces.** The Apple layer lives in `AppleGraphics` / `AppleAudio`, distinct
  from the kernel's `floorplan::` root. Inside `AppleGraphics`, `core` and `geom`
  are namespace aliases for `floorplan::core` / `floorplan::geom`.
- **SIMD only at the Apple boundary.** `Vec2` / `Vec3` use native `simd_float2/3`
  when `<simd/simd.h>` is available (Apple), and fall back to plain PODs elsewhere
  (`apple/graphics/types.hpp`). Core math stays **double-precision**; conversions
  (`toVertex2D` / `toVec2`) happen only at the render/collab boundary so the kernel
  is never tied to single precision.
- **App Intents are SIMULATED.** `AppIntentsBridge` is a dependency-light C++
  dispatcher modelling Assistant Schemas. Real App Intents are declared in Swift and
  surfaced to Siri/Spotlight; here `donateInteraction` just appends a string instead
  of calling `IntentDonationManager`.
- **SharePlay is SIMULATED.** `CollaborationManager` models GroupActivities /
  GroupSession behaviour (Spatial Persona roster + replicated op log) in pure C++,
  for offline, deterministic, unit-testable co-editing. No real peer transport.
- **Audio is SIMULATED.** `ProceduralSynthesizer` and `AudioSessionManager` model
  AVFoundation / AVAudioEngine and `AVAudioSession` route changes in pure C++ with
  no device I/O — phase-continuous sine rendering and a route counter.
- **Metal is a guarded DOC-STUB.** `RenderBackend` is abstract; the only built
  backend is `NullRenderBackend` (headless). A `MetalRenderBackend` is described in a
  header comment behind a `#if defined(__APPLE__) && __has_include(<Metal/Metal.hpp>)`
  guard using metal-cpp's `NS::TransferPtr`, but it is **not compiled** — no metal-cpp
  dependency is added.
- **Kernel ops are STUBS that limit quality.** `FloorPlan::autoLayout` wires
  `floorplan::ops::SeatingOptimizer`, which currently returns **2 fixed placements**,
  so auto-layout produces real tables but not an optimised arrangement. Likewise the
  NavMesh / pathfinding op is a kernel stub, so any pathfinding-quality features built
  on it are limited until the kernel ops are fully implemented. The wiring is correct
  and will scale up when the kernel ops land.

## Build & run

```sh
# Configure, build (ASan/UBSan + -Werror on our targets), and run all tests:
cmake -S cad-kernel -B cad-kernel/build
cmake --build cad-kernel/build
ctest --test-dir cad-kernel/build

# Run the end-to-end demo:
./cad-kernel/build/apple_demo
```

`apple_demo` constructs an engine and all three constructs, drives them through both
App Intents and typed methods, runs a spatial-collaboration scenario (including an
idempotent remote-op replay), reports synth triggers and a route change, drives a
couple of render frames, and prints a summary. It exits `0` on success; because the
build is ASan/UBSan instrumented, a clean exit also confirms no undefined behaviour
on the happy path.
