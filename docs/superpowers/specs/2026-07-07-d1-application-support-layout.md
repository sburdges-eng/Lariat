---
title: "D1-B — Application Support layout (approved)"
date: 2026-07-07
status: approved — sburdges 2026-07-07
parent: docs/superpowers/specs/2026-07-07-phase-iii-decisions-d1-d2-d4.md
implements_in: Wave C
---

# D1-B — Packaged recipe + data layout

Owner-approved layout for H8 native `.app` / `.pkg` distribution.

---

## Directory tree

```
~/Library/Application Support/Lariat/          ← LARIAT_ROOT (packaged default)
├── data/
│   └── lariat.db                            ← LARIAT_DATA_DIR default
├── recipes/
│   ├── recipe_index.csv
│   └── normalized/
│       └── {slug}.csv
├── menus/
│   └── beo_recipe_map.csv
└── audit/                                   ← existing ManagementAuditLogger path
```

---

## Resolver rules (Wave C implementation)

| Context | `LARIAT_ROOT` | `LARIAT_DATA_DIR` |
|---------|---------------|-------------------|
| Packaged `.app`, env unset | `Application Support/Lariat` | `{root}/data` |
| Dev repo | env or repo root walk | `{repo}/data` or env |
| CI / tests | explicit env in test | temp dir |

Extend `resolveDataDirectory` + `BeoCascadeClient.resolveProjectRoot` — **do not**
break existing cwd-walk dev behavior.

---

## First-run seed (Wave C)

When `recipes/recipe_index.csv` missing at support root:

1. Copy bundled seed snapshot (option: ship minimal tree in resource bundle), **or**
2. First-run wizard prompts for existing repo / data pack path (future H8 polish).

**Not in Wave A/B** — loader tests use repo `recipes/` via test helper.

---

## Recipe updates without rebuild

Operators rsync / ingest updated CSVs into Application Support — same layout as web
`recipes/` + `menus/`. No `.app` rebuild required.

---

## Explicitly rejected

- **Bundle-only recipes** in `.app/Contents/Resources/` as primary (stale on costing edits)
- **Env-only** `LARIAT_ROOT` with no default (fails double-click H8 smoke)

---

## Verification (Wave C + H8 gate)

- [ ] Launch packaged `.app` from Finder on clean Mac (no env vars)
- [ ] Assistant `scale_recipe` resolves manifest without `python3`
- [ ] BEO cascade tab returns order guide + prep demands
- [ ] `swift test` + Python oracle still green
