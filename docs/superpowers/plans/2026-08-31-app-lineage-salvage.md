---
title: "App-lineage audit: salvage record + deferred optimizations"
date: 2026-08-31
status: record of completed deletions + backlog of deferred items
canonical_id: app-lineage-salvage
---

# App-lineage audit — what was kept, salvaged, deleted, deferred

Four-agent read-only audit (2026-08-31) of every built Lariat app on Sean's
Mac, then a consolidation on Sean's explicit instruction: **one app remains**.

## Kept (the product)

`~/lariat_dev/Lariat/LariatNative/build/Lariat.app` — native v0.2.0 from
current main. 70 boards / 11 tiers, no stubs. Best of every generation;
the Electron cockpit's platform claims inverted on inspection (native has
notifications, printing, menu-bar panel, multi-window, Cmd-K; the wrapper
had none).

## Salvaged before deletion → `~/lariat_dev/stash-archive-2026-08-30/app-lineage-20260831/`

- `cockpit-compiled-paths.js` + `cockpit-version.json` — the July-9 wrapper's
  compiled `detectExistingDbDir()` (SQLite magic-header validation) that
  existed compiled-only; **restored to source in PR #652**.
- `lariat-ops-lariathr-bundles.zip` — both LariatHR bundles (the July-9
  GRDB build is the ONLY survivor of that generation; source tree
  "LARIAT TRY 3" is lost). Contains PII (client names, RecipeBook.pdf,
  real manager names) — never unpack into a repo.

## Deleted 2026-08-31 (Sean's explicit instruction, after archiving)

1. MacRescue checkout `LariatNative/build/Lariat.app` (v0.1.0) + `Lariat-0.1.0.pkg` — source byte-matched merged commit e5e178e; zero unmerged content.
2. MacRescue `dist/mac-arm64/Lariat.app` (655MB Electron cockpit) — wrapper source lives on main (`desktop/`).
3. `backup/Lariat/Lariat.app` — 36K broken skeleton.
4. MacBackup `Applications/Lariat Ops.app` + `.pre-dbfix-20260709071934` (zipped first).
5. MacBackup `Chrome Apps.localized/Lariat Cockpit.app` — Chrome PWA shim.

No Lariat app exists in `/Applications` or `~/Applications`. LaunchServices
confusion risk (duplicate `com.lariat.native` bundle ids) is gone.

## Done in this pass

- PR #651 — first-run DB seed (FirstRunBootstrap + resolveDataDirectory
  fallback), kitchen-language failure copy, rope icon, monotonic build numbers.
- PR #652 — desktop existing-DB detection restored with header validation.

## Deferred — needs Sean or a later pass

| Item | Blocked on | Notes |
|------|-----------|-------|
| **H8 Developer ID + notarization** | Sean's Apple identity | Ad-hoc signing quarantines on any other Mac; also stabilizes the PHI Keychain ACL. The existing H8 front. |
| **Auto-update channel (Sparkle)** | H8 signing first | Unsigned updates are worse than none. |
| **Crash breadcrumb + file logging** | design pass | `~/Library/Logs/Lariat` daily log + unclean-shutdown marker + "closed unexpectedly — View Log" (cockpit convention). Care: don't swallow the PHI sweep's loud stderr. |
| **Launch-at-login / kiosk resilience** | decide deployment shape | SMAppService; venue terminal should survive a reboot unattended. |
| **Native PIN custody via Keychain** | design pass | Replace LARIAT_PIN env (visible in ps) with the SickNoteKeychain pattern; wrapper's validation rules are the spec. |
| **LAN-hub / iPad architecture** | Sean's call | Native serves no ports by design; iPads need the web hub or a native sync story (ties to H7b + edge-blockers doc). |
| **Boot health gate** | small | "Not set up yet" screen off `RecipeManifestLoader.isSeeded` instead of empty boards. |
| **P7 HR paperwork suite** | design sign-off | `2026-08-31-hr-paperwork-suite.md`. |

## Standing cautions

- The recovery dump's remaining checkouts stay **read-only backups** (CLAUDE.md §1).
- Never rebuild the Electron wrapper casually: `desktop:dist` flips the shared
  `better-sqlite3` binding (CLAUDE.md §2).
- The seeded `~/Library/Application Support/Lariat` tree on Sean's Mac is a
  **smoke fixture**, not venue data — the G0 service day needs the real DB.
