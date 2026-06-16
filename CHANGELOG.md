# Changelog

All notable changes to Lariat are recorded here. The project ships on a
freeze-and-tag cadence; see `docs/V2_FREEZE_PLAN.md` for the v2 scope line and
`docs/V2_CUTOVER_PLAN.md` for the rollout plan.

## [2.0.0] — 2026-06-16

First tagged freeze of the Lariat restaurant F&B operations platform —
local-first, deterministic, single-venue. The v2 UI ships as an opt-in,
cookie-gated `/v2` route tree alongside v1; v1 stays the default until the
cutover stages complete (`docs/V2_CUTOVER_PLAN.md`, entry criteria satisfied
2026-06-12).

### Frozen / production-ready subsystems

**AI / language model**
- Kitchen Assistant (LaRi) grounded on local Ollama. **DeepSeek
  (`lari-the-kitchen-assistant`) is the default model.** Qwen 2.5 7B is selectable
  via `LARIAT_OLLAMA_MODEL` but stays deferred — it fails the prompt-eval gate
  (1/10 vs DeepSeek 7/10 on the Ollama leg).
- `db_query` LLM action: a registry of tier-gated, injection-safe,
  location-scoped queries with per-query row caps.
- Data Pack hybrid search (FTS5 ⊕ BGE, RRF fusion) over USDA / FDA / OFF /
  Wikibooks / FlavorDB, with graceful degradation.
- Prompt eval harness (`npm run eval:assistant-prompt`), 10/10 locked baseline.
- LaRi multi-turn conversation memory.

**HACCP food safety + labor compliance**
- 9 of 11 HACCP concepts with the `needs_corrective_action` 422 write-gate and
  transactional audit (source row + audit event roll back together).
- Labor: breaks, sick-leave, wage-notices, tip-pool. Certs informational-only for v2.

**Costing / compute / inventory**
- Compute engine (cost → margin → variance), dish-coverage snapshots, ABC ranking.
- Entity layer Phase 1; sales depletion Phase 3; JS↔Python unit/ingredient-key parity.
- Inventory counts + par + depletion; 86 board; prep board + fire schedule;
  station checklists + line checks.

**Events / live ops / venue**
- BEO / events with signed anonymous share-token flow.
- Shows / settlement / box office (live-music venue arm).
- KDS protocol (ticket bump, regression-tested) + the Lariat-KDS Swift client.

**Platform**
- Multi-instance peer sync: mDNS discovery, Ed25519 peer auth, append / replay / checkpoint.
- Cloud bridge push + dead-letter admin (pull/status deferred by design).
- Idempotency layer; PIN auth + temp PINs; env-var canonicalization.
- ETL pipelines: Toast (OAuth2 token refresh), Shamrock, Sysco (incl. photographed
  invoice line-item ingest), 7shifts (rate-limit backoff).
- Electron desktop (Electron 42 + better-sqlite3 12); PWA + offline queue.
- Spanish i18n for the v2 cook shells (catalog infrastructure, `/v2/today`,
  station checklist).

### v2 freeze close-out fixes (this release)
- **test:** fix `test-format-money-source` source guard after the BeoBoard
  `.jsx`→`.tsx` migration (stale path).
- **test:** fix `test-gold-stars-api` `created_at` double-localtime conversion that
  made the board's "today vs yesterday" assertion flaky in the early-morning
  UTC-offset window.
- **build:** declare `lxml` + `pdfplumber` in `requirements-tools.txt` so the
  Data Pack normalizer and Sysco-PDF-ingest Python tests are collectible.

### Verification gate (v2.0.0)
- eslint: 0 errors
- tsc (app + scripts): 0 errors
- jest: 139 passing
- node test runner: 4398/4399 (the one failure is a known mDNS concurrent-sweep
  artifact in `test-peers-route`; it passes 18/18 in isolation, and isolated mDNS
  unit tests are a tracked DEFERRED item)
- pytest: 339 passing, 3 skipped
- `next build --webpack`: clean

### Deferred (explicitly out of v2 scope → v2.1+ / v3)
- Entity layer Phase 2 (UUID FK columns + backfill migration).
- Cloud-bridge `pullSnapshot`/`status` (push-first is the documented stance).
- Prism integration (blocked on external API spec).
- Regulated certification write/audit workflow.
- `cad-kernel/` C++ engine (unwired orphan; out-of-scope move-out cleanup).
- Multi-venue management UX / rollout; `@ts-nocheck` migration; mDNS isolated unit tests.
- Voice input (Whisper); HACCP PDF generator.
