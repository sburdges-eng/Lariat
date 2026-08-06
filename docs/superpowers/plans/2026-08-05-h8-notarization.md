---
title: "Front 1 — H8 notarization / Developer ID"
date: 2026-08-05
status: planned — blocked on owner identity decision
parent: docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md
packaging: LariatNative/Scripts/PACKAGING.md
---

# Front 1 — H8 notarization / Developer ID

**Goal:** Ship a double-clickable, notarized distributable for the venue Mac.

## Decisions (owner)

- [ ] Developer ID Application identity string + Team ID
- [ ] Notarization Apple ID / app-specific password / `notarytool` profile name
- [ ] Artifact: `.pkg` (current default) vs `.dmg` vs both
- [ ] Sparkle vs manual update story (defer to H9 if undecided)

## Tasks

1. [ ] Document chosen identity in `PACKAGING.md` (no secrets in git)
2. [ ] `Scripts/package-app.sh --sign "Developer ID Application: …" --version 0.2.0 --pkg`
3. [ ] `xcrun notarytool submit … --wait` + staple
4. [ ] Fresh Mac / clean user: install → launch → Front 0 smoke subset
5. [ ] Confirm D1-B Application Support seed path works without shell env
6. [ ] Update endgame H8 checkbox + taxonomy Native 1.0 packaging note

## Gates

- `codesign --verify --deep --strict`
- `spctl --assess --type execute` accepts notarized app
- GUI launch smoke on a machine without Xcode/dev env

## Out of scope

Schema flip, web route deletion, Sparkle unless owner picks it now.
