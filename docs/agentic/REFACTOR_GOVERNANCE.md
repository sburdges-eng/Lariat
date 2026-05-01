# Refactor Governance

A safe, repeatable refactor workflow that improves Lariat's structure without changing behavior, schemas, runtime AI coupling, or kitchen/manager workflows.

Companion to [`BREAKER_AUDIT.md`](BREAKER_AUDIT.md). The breaker workflow finds defects; this workflow restructures code without introducing them.

## When to refactor

- Duplicate logic in 3+ call sites and a clear consolidation point.
- A module that has accreted multiple responsibilities and now blocks tests.
- A symbol whose name actively misleads readers (e.g. "computeX" that doesn't compute).
- Dead code with verified zero callers (per `gitnexus_impact`, not just grep).

## When NOT to refactor

- During an active feature batch in the same area.
- Under freeze.
- Without a target test that already pins behavior.
- If the cleanup-to-risk ratio is poor — three similar lines beat a premature abstraction.
- If you can't write the **Refactor Intake** below in five minutes, the target isn't well-defined enough yet.

---

## 1. Refactor Intake

Every refactor starts with a short ticket using [`templates/refactor-intake.md`](templates/refactor-intake.md):

```
Target:
Why now:
Behavior must stay identical:
Public API/schema touched: YES / NO
Runtime coupling risk: YES / NO
Affected tests:
Rollback path:
```

Stored at `docs/agentic/refactors/<YYYY-MM-DD>-<slug>.md`. The ticket is the contract; deviation from it = abort.

---

## 2. Containment

Use a worktree for anything more than a tiny edit (3+ files OR 1 file but cross-module):

```bash
scripts/worktree.sh new claude refactor-<area>
cd ../Lariat-worktrees/claude-refactor-<area>

node scripts/agent-session.mjs update \
  --tool claude --role implementer \
  --status "Refactor: <area>" \
  --claimed "path1,path2"
```

**No broad cleanup commits.** One refactor purpose per branch. If you discover a second smell, write it down — open a separate intake — don't ride along.

---

## 3. Classify Refactor Type

Use exactly one of these labels in the commit / PR title:

| Label | Description |
|---|---|
| **rename** | Symbol/file/path naming only. No body changes. |
| **extract** | Pull focused logic into a smaller helper/module. |
| **split** | Divide a large route/component/module by responsibility. |
| **move** | Relocate code without behavior change. |
| **dedupe** | Merge repeated logic behind one established local helper. |
| **contract-hardening** | Make invariants explicit (TS narrowing, runtime assertion) without changing payload shape. |

Anything else is not a refactor — it's a feature, fix, or revert. Use the right label.

---

## 4. Graph Gate

Before touching code, prove you understand the blast radius:

```
mcp__gitnexus__impact({target: "<symbol>", direction: "upstream"})   # who calls it
mcp__gitnexus__context({name: "<symbol>"})                            # callers + callees
mcp__gitnexus__query({query: "<area>"})                               # dynamic / string-keyed refs
```

If the index is stale, run `npx gitnexus analyze` first. **If risk is HIGH or CRITICAL, stop and report before editing** — re-scope the refactor or split it.

A clean grep does NOT substitute for the graph gate. Lariat has dynamic imports, LLM-action JSON, nav registry lookups by id, gitnexus-tool dispatchers — many call sites are invisible to grep.

---

## 5. Safety Tests First

Pick the **smallest existing tests** that already pin the behavior you're about to refactor. If none exist, write one before touching the code.

| Layer | Command |
|---|---|
| Pure logic | `node --test tests/js/test-<name>.mjs` |
| TS .ts imports | `node --experimental-strip-types --test tests/js/test-<name>.mjs` |
| UI | `npm run test:unit` |
| Regulated / audit | `node --test tests/js/test-<concept>-rules.mjs tests/js/test-<concept>-api.mjs tests/js/test-haccp-audit-atomicity.mjs` |
| Money / settlement | `node --experimental-strip-types --test tests/js/test-financial-acid.mjs tests/js/test-settlement-*.mjs` |
| Schema | `npm run test:schema` |

The safety test is the contract. If it goes red mid-refactor, **revert to last green**, don't push through.

---

## 6. Edit Order

Refactor in this order. Skipping a step is a process violation:

1. **Add or confirm the behavior test.** Run it. Green.
2. **Add the new helper / module behind the old interface.** No callers updated yet. Green.
3. **Move internal callers** one by one. Green after each.
4. **Remove the duplicate / old code.** Green.
5. **Run targeted tests.** Green.
6. **Run `mcp__gitnexus__detect_changes()`.** Confirm only expected symbols are affected.
7. **Run broader section tests** only if blast radius justifies it (e.g. cross-module move).

Each step gets its own commit. The reviewer should be able to bisect cleanly.

---

## 7. Refactor Stop Rules

Abort or re-scope **immediately** if any of these become true mid-refactor:

| Stop condition | Why |
|---|---|
| Schema payload shape changes | That's a migration, not a refactor — needs `lib/db.ts::initSchema` / `migrateLegacyColumns` and a test. |
| Location scoping semantics change | `docs/PATTERNS.md §4` is binding; any deviation is a feature. |
| Audit transaction boundary moves | Regulated; needs explicit review per `docs/PATTERNS.md §3`. |
| PIN gate behavior changes | Manager-route security; needs middleware + in-route review. |
| Runtime cloud/API dependency appears | Lariat is local-first deterministic; new coupling is out of scope for any refactor. |
| User-facing copy changes without explicit product reason | UI copy is binding per `docs/UI_COPY_RULES.md`. |

If you hit a stop, write down what you found in the intake doc, open an issue, revert, and walk away from the refactor.

---

## 8. Report Format

Every merged refactor PR includes a `REFACTOR_REPORT` block in the description:

```
REFACTOR_REPORT:
- Target:
- Type:                        rename / extract / split / move / dedupe / contract-hardening
- Files Modified:
- Behavior Changed:            YES / NO   (must be NO)
- Contract Changed:            YES / NO   (must be NO)
- Runtime Coupling Introduced: YES / NO   (must be NO)
- GitNexus Risk:               LOW / MEDIUM / HIGH / CRITICAL
- Tests Run:                   <list of npm scripts / node --test invocations>
- Follow-up Risks:             <e.g. "two more call sites in unrelated branch can dedupe later">
```

Three NOs and a non-CRITICAL risk are required to merge. Anything else is a re-scope.

---

## Change Declaration (for this workflow doc)

- **Affected subsystem:** Lariat refactor governance.
- **Freeze-readiness impact:** positive if enforced.
- **Determinism impact:** positive — graph-gated and test-pinned.
- **Security impact:** positive — preserves PIN/audit/location boundaries.
- **Runtime coupling introduced:** NO.

---

## See also

- [`BREAKER_AUDIT.md`](BREAKER_AUDIT.md) — the sister workflow for finding defects.
- [`AGENT_ROLES.md`](AGENT_ROLES.md) — base role definitions; refactors are an Implementer activity governed by Architect.
- [`MULTI_TOOL_PIPELINE.md`](MULTI_TOOL_PIPELINE.md) — handoffs between Claude / Codex / Gemini.
- [`templates/refactor-intake.md`](templates/refactor-intake.md) — intake template.
- `docs/PATTERNS.md` — load-bearing patterns the stop rules guard.
