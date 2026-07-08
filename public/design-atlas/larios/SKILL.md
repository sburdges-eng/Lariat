---
name: lariat-design
description: Use this skill to generate well-branded interfaces and assets for The Lariat / LaRiOS (the "Service Ledger" kitchen-ops cockpit), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping a warm-dark, high-density professional kitchen tool.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick orientation
- **What it is:** LaRiOS, the operational cockpit for The Lariat (an 1885 CO music venue + restaurant). Warm **dark mode**, high-density "hardened pro tool" — "AutoCAD meets a historic saloon." No pure black, no glassmorphism, no bubbly UI.
- **Tokens:** link `styles.css`. Canvas `--bg #1a1711`, panels `--panel/--panel-2`, hairline `--hair`, text `--text #d4cbb5`. One accent: gaslight amber `--accent #e0922b`. Warm status: `--fire` (oxblood/86), `--ok` (sage), `--metal` (brass/warn).
- **Type:** Archivo (engineered grotesque — headings, board titles, small-caps stamps), Inter Tight (UI/body), JetBrains Mono (ALL figures, tabular). No italics.
- **Shape:** sharp corners (3/6/12px). Depth = 1px hairlines + contrast, NOT shadows (shadows are for floating menus/modals only).
- **Voice:** kitchen-native, terse, ~5th–8th grade. "86, prep, par, fire, low, out, done, count." Never SaaS words ("submit/configure/dashboard"). No emoji.

## Components
React primitives compiled into the bundle: BrandStamp, StationRing, Button, Pill, Tag, StatusDot, Kpi, Bar, Avatar, Input, Select, Textarea, Field, DataTable, Tabs, Card. See each `components/<group>/<Name>.prompt.md` for usage.

## Reference UI
`ui_kits/cockpit/index.html` is a full interactive recreation (shell chrome + Today/86/stations/temps/stock/recipes) — the best reference for how screens are composed.
