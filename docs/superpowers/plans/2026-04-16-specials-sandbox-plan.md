# Specials & R&D Sandbox Implementation Plan

> **STATUS: SHIPPED (verified 2026-06-15 reconciliation) — specials sandbox fully implemented: nav (navRegistry), UI page, creative API endpoint (CREATIVE_SYSTEM + `cost_special` action), saved-specials dashboard. Checkboxes below are historical.**

The goal is to add a creative "Specials" sandbox to the Lariat Cockpit. Unlike the strict "Kitchen Assistant" which prevents all fabrication, this section encourages the AI to generate new recipes, estimate costs, and suggest uses for overstock.

## Proposed Changes

### Navigation & UI
#### [MODIFY] app/_components/Sidebar.jsx
- Add a persistent link to the new section: `{link('/specials', 'Specials (R&D)')}` inside the navigation.

### Page Components
#### [NEW] app/specials/page.jsx
- A client-side React component that offers:
  1. A "Pantry/Prompt" input where the user can enter what they have (ingredients, overstock, amounts).
  2. A "Sandbox Chat" view using the new creative Ollama endpoint.
  3. A temporary "Sandbox Recipe" view where the user can scratchpad sizes/weights/costs as they iterate on the dish.

### AI Engine & Security Rules
#### [MODIFY] lib/ollama.ts
- Export the `HACCP_BLOCK` and `ALLERGEN_BLOCK` rules so they can be injected into the new creative system prompt.

#### [NEW] app/api/specials/route.js
- A new endpoint `/api/specials` identical in structure to `/api/kitchen-assistant`, but running a `CREATIVE_SYSTEM` prompt.
- **Constraints**: It will use the base Lariat HACCP/Allergen guardrails, but it will be explicitly instructed to *inspire recipes, propose substitutions, suggest complimentary additions, and help utilize overstocked ingredients*.

## Open Questions
1. Do you want the AI to automatically query the `costing` database tables for the ingredients you mention, or should it mostly focus on idea generation?
2. Should we save these "Specials" to the database once the chef is happy, or does it remain completely ephemeral (scratchpad only) for now?
