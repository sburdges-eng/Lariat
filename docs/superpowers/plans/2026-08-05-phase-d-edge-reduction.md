---
title: "Front 4 — Phase D edge reduction"
date: 2026-08-05
status: planned — gated on C5
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
checklist: docs/superpowers/specs/2026-07-02-lariat-native-phase-d-e-checklists.md
blockers: docs/superpowers/specs/lariat-native-edge-blockers.md
---

# Front 4 — Phase D edge reduction

**Goal:** Next.js serves only edge-blocker surfaces (+ ratified peers/cloud-bridge transport).

## Tasks (from D1–D7 checklist)

1. [ ] D1 Freeze edge scope (A5.4 already ratified: edge transport + native read-only status)
2. [ ] D2 Resolve `/v2/*` vs v1 duplicates — one surviving behavior
3. [ ] D3 Delete operator pages + APIs wave-by-wave (already write-dead after C5)
4. [ ] D4 Keep: BEO share/sign, optional PWA/install, login-pin if needed, schema handshake
5. [ ] D5 Strip dead deps; CI guard on route count
6. [ ] D6 Docs: web = edge server runbook
7. [ ] D7 Exit: shutoff test is permanent default mode

## Gates

- Route inventory == blocker log ∪ ratified transport
- `npm run build` + targeted edge tests green
- Native remains daily driver
