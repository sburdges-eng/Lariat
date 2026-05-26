# cad-kernel

A standalone **C++23 geometry / CAD kernel**. It is **not wired into the Lariat
Next.js application** — there is no Node addon, WASM bridge, or shell-out from
`app/` or `lib/` that calls it. It builds and tests independently via CMake.

## What's in here

| Area | Headers |
|------|---------|
| Geometry | `curves`, `clothoid`, `transform`, `boolean_ops`, `mass_properties`, `dimensioning`, `selection` |
| Spatial index | `bounding_volume`, `octree`, `tin` |
| Geodesy / survey | `geodesy`, `crs`, `vertical_alignment` |
| Solver | `jacobian`, `newton_raphson` |
| Ops | `pathfinding` (A\*), `seating_layout` |
| I/O | `dxf_parser` |
| Core | `scene_graph` |

The `pathfinding` and `seating_layout` ops hint at the intended use: **future
floor-plan / seating-designer work** for the restaurant cockpit (drag-and-drop
table layout, walkway pathing, capacity optimization). None of that UI exists
yet — the live floor plan (`app/_components/Floorplan.jsx`) is hand-drawn SVG
zones with no CAD dependency.

## Status & scope decision (2026-05-24)

Reviewed during the v2 freeze audit (`docs/V2_FREEZE_PLAN.md` §3). Decision:
**keep in-tree, fenced.**

- Build artifacts (`build/`, `build2/`) are gitignored; only source is tracked.
- It does not participate in `npm run build` / `dev` (those pin `--webpack`
  over `next.config.mjs`; the kernel is invisible to the JS toolchain).
- Revisit extraction to a dedicated repo (`Lariat-CAD`) or
  `~/Dev/FloorPlanDesigner` if/when the seating designer is actually built, or
  if the kernel grows enough to warrant its own CI.

## Build

```bash
cmake -S . -B build && cmake --build build
ctest --test-dir build        # unit tests under tests/
```
