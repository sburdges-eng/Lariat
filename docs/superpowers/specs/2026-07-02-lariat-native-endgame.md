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

## 1. Scoreboard (updated 2026-07-02 end-of-run — **Phases A + B COMPLETE**)

| Measure | Web (source of truth) | Native (`origin/main`) |
|---|---|---|
| Page routes | 107 (incl. 9 `/v2/*` variants) | **~74 boards across 17 tiers** (cook, safety, labor, inventory, manager, costing, purchasing, foh, shows, house, beo + assistant) |
| API route files | 195 across 71 groups | n/a (direct GRDB reads + audited writes) |
| Feature areas | ~36 | **all operator-facing areas native or edge-logged** |
| Tests | ~142 `tests/js/test-*` suites | **2,273** (`swift test`, 0 failures) |
| Guest-facing surfaces | 2 (BEO share/sign, PWA install) | permanently edge (logged in `lariat-native-edge-blockers.md`) |

**Phase A exit reached 2026-07-02** (PRs #384–#397): A0–A6 all merged, every wave
adversarially verified where money/safety-critical (A5, A6.3, A6.4, Phase B — the
skeptic panels caught 2 criticals + 12 majors that agent self-reports missed, all
fixed with regression pins). **Phase B merged** (#399): the assistant runs natively
against local Ollama with all 10 mutating LLM actions audited + undo-gated.
Holistic bar: H1 tokens ✓ · H2 state grammar ✓ · H3 ⌘K palette + board search ✓ ·
H4 menu commands ✓ · H5 shared poller (54 boards, backoff/pause/freshness/⌘R) ✓ ·
H9 README refreshed ✓. Remaining: H6/H7/H8 (notifications+printing, a11y+iPad,
signed .app + icon) — these need an .app-bundle/signing-identity decision from the
owner and are the next polish wave; §2's shut-off test needs a real service day.

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

- [x] Every operator-facing web feature area is native **or** in the edge-blocker log — no third bucket. *(2026-07-02, #384–#397)*
- [x] All `deferred`/`not ported` markers in Swift sources resolved or explicitly accepted here. *(dish-cost bridge landed #391; remaining deferrals documented per wave: semantic/BGE channels, db_query/code_search soft-responses, prep-median cosmetic, temp-PIN course relaxation)*
- [ ] §2 shut-off test passes for a full service day. *(operational — needs a real service day; everything code-side is in place)*
- [x] Phase B assistant at parity *(#399)*; — [ ] Phase C inversion complete *(sub-spec ready; gated on the shut-off test + 7-day reconciliation window)*.
- [x] Holistic bar H1–H5 done; — [ ] H6/H7/H8 *(need an .app-bundle + signing-identity decision from the owner)*; H9 continuous.
- [ ] Web codebase reduced to the edge-blocker set (Phase D — checklist ready, gated on C).
- [ ] Consolidation executed with rails (Phase E — ☠ user-confirmed steps by design).
- [x] `swift build && swift test` green throughout; every wave PR'd, never pushed to `main`. *(16 wave PRs, 2,273 tests)*

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
