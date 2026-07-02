# Phase D & E — Execution Checklists (edge reduction, cutover + consolidation)

**Date:** 2026-07-02
**Status:** Checklists ready; execution gated on Phase C exit. **Phase E steps are
destructive and require explicit user confirmation at each ☠ step — no autonomous runs.**
**Parent docs:** roadmap (`2026-06-30-…-roadmap-design.md`), Phase C sub-spec,
endgame (`2026-07-02-lariat-native-endgame.md`), edge-blocker log.

## Phase D — Reduce Next.js to the edge

Scope authority: `lariat-native-edge-blockers.md` (today: guest BEO share-and-sign,
PWA/remote access; pending decision: cross-host sync/peers/cloud-bridge transport).

- [ ] D1. Freeze the edge scope: close the A5.4 decision (sync on edge vs native) and
      any remaining blocker-log candidates; the log becomes the *whole* web surface.
- [ ] D2. Resolve the `/v2/*` duplicate routes: delete the frozen variant (v1 or v2
      per the `v2-freeze-closeout` outcome) so exactly one behavior survives.
- [ ] D3. Delete operator page routes + their API routes from the web app, wave by
      wave, mirroring the C5 cutover order (routes already write-dead after C).
- [ ] D4. Keep + harden: `/beo/share/[token]` (+ sign POST + audited write),
      `/install` + PWA manifest/SW *only if* remote read access stays in scope,
      `/login-pin` only if an edge surface still needs auth, the C2 schema-version
      handshake, and whatever D1 added.
- [ ] D5. Strip dead deps (charting, editors, etc.), re-run the web build, and CI-guard
      the route count so operator surfaces can't silently return.
- [ ] D6. Update docs: README (web = edge server), DEMO, deployment notes; edge server
      gets its own minimal runbook (start, port, data-dir, backup).
- [ ] D7. Exit: web app serves only edge-blocker surfaces; native is the daily driver;
      endgame §2 shut-off test is now the *permanent* operating mode, inverted — the
      edge runs only when a guest link or remote view is needed.

## Phase E — Cutover + consolidation / delete (☠ user-confirmed, step-by-step)

Rails (from the roadmap — restated as the checklist's first law): **load-bearing paths
are relocated/absorbed first and removed from the delete set; nothing is deleted blind;
every ☠ step is preceded by a verified backup and explicit user confirmation.**

- [ ] E1. Choose + document the one canonical home (Swift app bundle, edge server,
      `data/` incl. `lariat.db` + JSONL audit dir + caches).
- [ ] E2. Relocate/absorb load-bearing paths, then strike them from the delete list:
      `~/Dev/hospitality/Lariat` (canonical repo), `…/LariatNative`, `…/Lariat-KDS`,
      `~/Dev/lariat-data-sources` (**real PII — relocate with the same protections**).
- [ ] E3. Build the delete manifest: enumerate the ~100 duplicate paths with sizes +
      last-modified; classify each (duplicate-of-canonical / stale-copy / unknown).
      **Unknown ⇒ investigate, never delete.**
- [ ] E4. ☠ Verified full backup of the canonical home + the delete manifest targets
      (restore-tested, checksummed) before any removal.
- [ ] E5. ☠ Delete confirmed duplicates in small batches (user confirms each batch);
      after each batch: canonical app still launches, tests green, data intact.
- [ ] E6. Final state: one canonical location; distribution story live (signed +
      notarized app per endgame H8); memory + docs updated; delete manifest archived
      with what was removed and when.

## Standing prohibitions

- Never delete a path that appears in the load-bearing list, in any state.
- Never run E-steps in the same session that produced the manifest without a fresh
  `git status`/path re-verification (concurrent sessions share these trees).
- PII paths get relocation + verification, never bare deletion.
