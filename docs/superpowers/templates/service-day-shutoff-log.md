---
title: "Service-day shutoff test log (G0 template)"
date: 2026-07-07
status: template — fill when test runs
parent: docs/superpowers/specs/2026-07-02-lariat-native-endgame.md
---

# Service-day shutoff test log

> **North star (endgame §2):** Shut the Next.js server off for a full service day.
> Every operator task completes in the native app; only edge-blocker surfaces break.

---

## Run metadata

| Field | Value |
|-------|-------|
| Date | YYYY-MM-DD |
| Location | |
| Tester | |
| Native build | branch / commit / `.app` version |
| Next.js | **OFF** (how verified: port 3000 closed / process killed) |
| Duration | Full service / partial (hours) |

---

## Boards exercised (check all that ran)

| Tier | Board | Pass | Notes |
|------|-------|------|-------|
| cook | | ☐ | |
| safety | | ☐ | |
| labor | | ☐ | |
| inventory | | ☐ | |
| manager | | ☐ | |
| costing | | ☐ | |
| purchasing | | ☐ | |
| foh | | ☐ | |
| shows | | ☐ | |
| house | | ☐ | |
| beo | | ☐ | |
| assistant | | ☐ | |

---

## Regulated writes spot-check

| Action | PIN required? | Audit row present? | Pass |
|--------|---------------|-------------------|------|
| HACCP temp log | | | ☐ |
| 86 item | | | ☐ |
| BEO prep done | | | ☐ |
| Assistant scale_recipe | | | ☐ |

---

## Known gaps / edge surfaces (expected breaks)

List only items from `lariat-native-edge-blockers.md`:

| Surface | Broke as expected? | Notes |
|---------|-------------------|-------|
| Guest BEO e-sign | | |
| PWA / remote | | |
| *(add)* | | |

---

## Unexpected failures (blockers)

| # | What failed | Severity | Ticket / fix |
|---|-------------|----------|--------------|
| 1 | | | |

---

## Gate verdict

- [ ] **G0 PASS** — log appended to endgame doc; no unexpected operator blockers
- [ ] **G0 FAIL** — list blockers above; do not start C5 cutover

**Sign-off:** _________________ Date: _________
