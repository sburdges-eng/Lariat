# AGENTS.md — Lariat

Restaurant F&B operations: recipes, costing, inventory, HACCP, POS. Culinary datasets belong to this project.

1. Goal: simplify BOH (back-of-house) operations. If a change makes kitchen/manager workflows more complex, it is wrong.
2. UI rules: no underscores, no dev-style column names, USD to 2 decimals, "Spring"/"Fall" (never "Shoulder"). STRICT: See `docs/UI_COPY_RULES.md` for mandatory line-cook language constraints (e.g. no SaaS jargon, short labels).
3. This project is food/restaurant ops — do **not** confuse with COOLIO (image API) despite overlapping "cool" naming.
4. HACCP / food-safety logic is regulated — do not weaken validations or silently auto-correct records; surface errors.
5. See `CLAUDE.md` (if present) and `docs/` for architecture. Schema changes require a migration, never in-place edits.
6. Test with real-looking recipe/inventory data, not synthetic `foo`/`bar` fixtures — the domain rules only surface with realistic data.
