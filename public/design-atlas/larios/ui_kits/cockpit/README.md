# Cockpit — LaRiOS UI kit

An interactive, high-fidelity recreation of **The Lariat Kitchen Cockpit**, the
flagship LaRiOS surface. Ported from the shipping web app
(`sburdges-eng/Lariat` · `app/`, `styles/globals.css`, `app/_components/*`).

**Entry:** `index.html` (designed at 1280×800).

## What it shows
Fixed cockpit shell + click-through boards:

- **Service strip** (top) — brand mark, service-phase timeline (Prep · Open ·
  Rush · Close) with the live "now" marker, and the clock/heat chip.
- **The Line** (left rail) — brand, primary nav with mono shortcut keys, live
  **station rings**, compliance section, and the "clocked in as" cook picker.
- **Command bar** (bottom) — keyboard hints (`⌘K`, `/`, `1–6`, `8`).
- **Today** (rush home) — editorial hero, ready/flagged/86 stat stack, the
  86'd panel, station tiles, quick actions.
- **86 Board** — add/clear items out; "might also be out" cascade tags.
- **Station** — a line-check list with sign-off / flag.
- **Temp Log** — CCP holds with in-range/at-limit/out KPIs.
- **Stock** — par vs on-hand grid with fill bars.
- **Recipes** — the book, with allergen pills.

Nav and quick actions are wired; forms mutate local state only.

## Files
- `index.html` — mounts the app, routes views.
- `Shell.jsx` — service strip, sidebar, command bar chrome.
- `Screens.jsx` — the board screens.
- `cockpit.css` — shell chrome (ported from `styles/globals.css`).
- `data.js` — fake service data (`window.COCKPIT`).

Composes the design-system components from `_ds_bundle.js` — it does not
re-implement primitives.
