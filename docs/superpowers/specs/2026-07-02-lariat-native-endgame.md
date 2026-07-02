# LariatNative — Endgame Definition (conversion parity + holistic bar)

**Date:** 2026-07-02
**Status:** Approved shape. Complements (does not replace) the full-replacement roadmap
(`2026-06-30-lariat-native-full-replacement-roadmap-design.md`) and the A4–A6 handoff
(`plans/2026-07-02-lariat-native-a4-a6-roadmap-and-handoff.md`).
**Owner:** Sean Burdges

## What this document is

The roadmap defines the *phases* (A–E). The handoff defines the *remaining Phase-A work*.
This document defines the **finish line**: the checkable conditions under which the Swift
conversion is *done*, plus the **holistic bar** — the product qualities that make the native
app better than the web cockpit, not merely equal to it. Sessions picking up "finish the
conversion" should drive toward §5 and pull work from §4.

## 1. Scoreboard (as of 2026-07-02)

| Measure | Web (source of truth) | Native (`origin/main`) |
|---|---|---|
| Page routes | 107 (incl. 9 `/v2/*` variants) | 29 registered features (+8 in flight: A4.1 PR #385, A4.2 branch) |
| API route files | 195 across 71 groups | n/a (direct GRDB reads + audited writes) |
| Feature areas | ~36 | ~19 covered or in flight |
| Tests | ~142 `tests/js/test-*` suites | 900 (`swift test`, green) |
| Guest-facing surfaces | 2 (BEO share/sign, PWA install) | permanently edge (logged in `lariat-native-edge-blockers.md`) |

**Remaining Phase A:** A4 (in flight: A4.1 inventory PR #385, A4.2 costing branch;
A4.3 menu-engineering + A4.4 purchasing open) · A5 (management writes) · A6 (FOH + events
+ shows, entirely greenfield). Per-wave plans and risks live in the A4–A6 handoff.

## 2. The endgame test (north-star, checkable)

> **Shut the Next.js server off for a full service day.** Every operator task — line checks,
> temps, 86s, KDS, labor, costing, inventory, purchasing, management, FOH, shows, BEO
> management — completes in the native app with rules and audited writes intact. The only
> things that break are the surfaces in the edge-blocker log (guest BEO e-sign, PWA/remote),
> which is exactly what the thin edge server exists for.

When that test passes and §5 is checked, Phases D/E (edge reduction, cutover + consolidation)
are unblocked.

## 3. Phase exit criteria (B–E, concretized)

- **B — Kitchen assistant (LLM).** Native Swift client talks to the local model directly
  (current DeepSeek/Ollama; do **not** flip `LARIAT_OLLAMA_MODEL` — qwen fails the eval).
  Citations, datapack search, conversation memory at parity; assistant *actions* go through
  the same audited-write contracts as human writes.
- **C — Schema inversion.** Native owns schema + migrations + write-side rules; web edge
  becomes the reader. Requires its own sub-spec (dual-write shadow period, rule inventory
  from the ~130 API routes, `actor_source` canonical taxonomy, rollback plan, integrity
  parity tests). Highest-risk phase; do not start while Phase-A waves are landing.
- **D — Edge reduction.** Web app stripped to exactly the edge-blocker log (+ the A5.4
  sync/peers decision if it lands "edge"). Everything else deleted *from the web codebase*.
- **E — Cutover + consolidation.** One canonical location; load-bearing paths
  (`~/Dev/hospitality/Lariat`, `LariatNative`, `Lariat-KDS`, `~/Dev/lariat-data-sources` = PII)
  relocated/absorbed **first**, then verified-backup → per-step confirmed deletion of the
  ~100 duplicates. Never blind.

## 4. The holistic bar (beyond parity)

Parity clones the web app; these make the native app the *better* daily driver. Ordered by
leverage; H1–H2 started 2026-07-02 (this branch).

- **H1 Design tokens.** One semantic palette (`LariatTheme`: ok/warn/bad/info + spacing +
  radius) replacing per-view hard-coded colors and 8 duplicated tone functions. *Started:*
  `DesignTokens.swift`; adopt opportunistically as views are touched, mandatory for new ports.
- **H2 Consistent state grammar.** Every board renders the same four states: loading
  (labeled), empty (shared `EmptyState` — icon + guidance, not bare `Text`), error/degraded
  (`TileDegrade`), data. *Started:* `EmptyState.swift` + adoption in cook/safety boards.
- **H3 Findability.** Per-board search/filter on list-heavy boards (*started:* 86, KDS,
  stations, date marks) → then a global **⌘K command palette** over `FeatureCatalog`
  (A0 registry makes this nearly free: fuzzy-match feature titles + jump).
- **H4 Keyboard-first macOS.** Menu-bar commands + shortcuts: ⌘1/⌘2/⌘3 tier switch, ⌘R
  refresh-now, ⌘F focus search, ⌘K palette. Cooks on a Mac mini in the pass shouldn't
  need the trackpad.
- **H5 Smart refresh.** Replace the 26 independent 3-second poll loops with a shared
  poller: backoff on error, pause when window inactive, and a visible data-freshness
  indicator (last-refreshed + stale warning) in the shell.
- **H6 Platform integration.** Local notifications for red signals (86 spikes, HACCP
  breach, cooling overdue); native printing for settlement/BEO/line sheets; menu-bar
  extra with tonight's headline numbers; multi-window (e.g. KDS on a second display).
- **H7 Accessibility + iPad.** VoiceOver labels on tiles/badges, Dynamic Type survival,
  and the iPad cook tier the roadmap promises (touch targets, stage-manager layouts).
- **H8 Distribution.** App icon (web `public/logo.png` exists; needs an `.icns` pass),
  signed + notarized `.app`, versioning surfaced in-app, update story (Sparkle or manual).
- **H9 Docs truth.** `LariatNative/README.md` still describes the P3b era (199 tests vs 900
  actual); refresh it + keep a parity scoreboard table current per merged wave.

## 5. Definition of Done (the endgame checklist)

- [ ] Every operator-facing web feature area is native **or** in the edge-blocker log — no third bucket.
- [ ] All `deferred`/`not ported` markers in Swift sources resolved or explicitly accepted here.
- [ ] §2 shut-off test passes for a full service day.
- [ ] Phase B assistant at parity; Phase C inversion complete (native owns schema).
- [ ] Holistic bar H1–H8 done (H9 continuous).
- [ ] Web codebase reduced to the edge-blocker set (Phase D).
- [ ] Consolidation executed with rails (Phase E) — duplicates gone, one canonical home.
- [ ] `swift build && swift test` green throughout; every wave PR'd, never pushed to `main`.

## 6. Open decisions (carried + new)

1. Tier naming for A4/A6 groups (`.costing`/`.inventory` exist in flight; `.foh`/`.shows` TBD).
2. **A5.4 sync/peers/cloud-bridge:** native sync client vs. keep transport on the edge
   (recommend edge; port read/status UI only).
3. **Web F15 glove-change** removal in flux (`v2-freeze-closeout` stash) — mirror in native
   stations if it lands.
4. **`/v2/*` web routes:** native already ports the v2 *behavior* where it's the better spec
   (e.g. Today = `/v2/today`). At Phase D, v1/v2 duplicates collapse — native parity targets
   the *surviving* behavior, not both.
5. **H5 poll cadence:** 3 s was chosen for cross-process visibility (ValueObservation can't
   see other processes' writes); the shared poller must keep ≤5 s freshness on active boards.
