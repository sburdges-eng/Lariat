---
title: "Native 0.2 L1 — error codes and JSON wire parity"
date: 2026-07-07
status: prep
canonical_id: native-0.2-l1
deprecated_alias: phase-iii
parent: docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-wave-c.md
---

# Wire parity — calculator + cascade (L1 Wave C)

> **Terminology:** [`docs/NATIVE_RELEASES_AND_TAXONOMY.md`](../../NATIVE_RELEASES_AND_TAXONOMY.md)

Reference for **L1 Wave C** when removing spawn/JSON CLI layers.

---

## Recipe calculator (`RecipeCalculatorError`)

| Code | In-process behavior |
|------|---------------------|
| `bad_multiplier` | **Keep** — Swift validation before expand |
| `timeout` | **Remove** — no spawn |
| `spawn_failed` | **Remove** |
| `cli_error` | Map to `expand_failed` or domain `BomExpandError` message |
| `exit_N` | Map to typed `BomExpandError` |
| `bad_json` | **Remove** — no stdout parse |
| `bad_shape` | **Remove** |

Preserve user-facing message strings where kitchen assistant displays them.

---

## BEO cascade (`CascadeError`)

| Code | In-process behavior |
|------|---------------------|
| `timeout` | **Remove** |
| `spawn_failed` | **Remove** |
| `cli_error` | Map from `build_cascade` internal errors |
| `bad_json` | **Remove** |
| `bad_shape` | **Remove** on in-process path |
| `empty_line_items` | **Keep** — short-circuit before compute |

Existing literals in `BeoCascadeClient.swift` / `lib/beoCascade.ts` must match for any edge path kept in Phase D.

---

## `build_cascade` result shape (preserve)

```json
{
  "order_guide": [{"ingredient","unit","total_needed","on_hand","to_order"}],
  "prep_demands": [{"recipe_slug","display_name","qty","unit"}],
  "unmapped": [{"menu_item","reason"}],
  "warnings": ["..."],
  "manifest_warnings": [{"recipe","issue"}]
}
```

Swift `CascadeResult` already models this — `BeoCascadeCompute` returns same structs, no JSON round-trip.

---

## CLI exit codes (offline Python only — keep)

| Exit | Meaning |
|------|---------|
| 2 | bad input |
| 3 | unknown recipe |
| 4 | unit mismatch |
| 5 | cycle |
| 6 | invalid recipe |
