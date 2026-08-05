# cad-kernel (historical / fenced)

**Canonical home moved to**
[`~/Dev/CAD/projects/FloorPlanDesigner/kernel/`](../../../CAD/projects/FloorPlanDesigner/kernel/)
(2026-08-05).

This in-tree copy remains **fenced** — not wired into the Lariat Next.js
application. Prefer editing the FloorPlanDesigner tree for new kernel work.
Do not duplicate fixes in both places unless intentionally syncing.

## Build (local copy only)

```bash
cmake -S . -B build && cmake --build build
ctest --test-dir build
```

See FloorPlanDesigner `kernel/README.md` for the module map and scope rules.
