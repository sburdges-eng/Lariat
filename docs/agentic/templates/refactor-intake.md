# Refactor Intake

> Copy this file to `docs/agentic/refactors/<YYYY-MM-DD>-<slug>.md`.
> One intake per refactor branch. The intake is the contract — deviation from it = abort.

---

**Target:**
<!-- The specific symbol / file / module being refactored. Be exact: "lib/auditEvents.ts::postAuditEvent" not "audit code". -->

**Why now:**
<!-- The triggering reason. Duplication count, blocked test, misleading name, etc. If you can't write this in two sentences, the target isn't well-defined yet. -->

**Behavior must stay identical:**
<!-- The list of behaviors that MUST be unchanged. Cite tests where possible: "test-auditevents.mjs::audit row written inside tx". -->

**Public API/schema touched:** YES / NO
<!-- YES = aborts the refactor. That's a feature, not a refactor. -->

**Runtime coupling risk:** YES / NO
<!-- YES = aborts. New cloud/API dependency is out of scope for any refactor in Lariat. -->

**Affected tests:**
<!-- List the smallest set of existing tests that pin behavior. Cite filenames + key test names. -->

**Rollback path:**
<!-- One sentence on how to back out if the refactor goes sideways. Usually "git revert <merge SHA>" but call out anything additional (e.g. cache rebuild). -->

---

## Classification

**Type:** rename / extract / split / move / dedupe / contract-hardening

**GitNexus impact (run before editing):**
<!-- Paste the relevant fields from mcp__gitnexus__impact: blast_radius, risk_level, affected_processes. -->

---

## Edit log

Tick each step as completed. Skipping a step is a process violation.

- [ ] 1. Add/confirm behavior test. Green.
- [ ] 2. New helper/module behind old interface. Green.
- [ ] 3. Move internal callers one by one. Green after each.
- [ ] 4. Remove duplicate/old code. Green.
- [ ] 5. Targeted tests pass.
- [ ] 6. `mcp__gitnexus__detect_changes()` shows only expected affected scope.
- [ ] 7. Broader section tests pass (only if blast radius justifies it).

---

## Stop trip

Tick if you hit any stop condition. Hitting one = abort and re-scope.

- [ ] Schema payload shape changed
- [ ] Location scoping semantics changed
- [ ] Audit transaction boundary moved
- [ ] PIN gate behavior changed
- [ ] New runtime cloud/API dependency
- [ ] User-facing copy changed without explicit product reason
