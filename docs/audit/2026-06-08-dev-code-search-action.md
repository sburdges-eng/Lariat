# Dev Code Search Action - 2026-06-08

## Scope

Affected subsystem: LaRi kitchen assistant local development tooling.

Freeze-readiness impact: positive. Roadmap row 2.5 is closed with a focused, test-pinned action that stays outside production unless explicitly enabled.

Determinism impact: positive. The tool uses local ripgrep with fixed arguments, fixed string matching, bounded result count, deterministic table rendering, and schema-versioned outcomes.

Security impact: neutral to positive. The action is manager-tier, disabled by default, does not call any cloud API, rejects path traversal globs, serializes only relative paths, and redacts raw search text from audit payloads.

Runtime coupling introduced: no. The only runtime dependency is local `rg` when `LARIAT_DEV_CODE_SEARCH=1` is set in a development shell.

## Contract

The route advertises `code_search` only when both conditions are true:

- `LARIAT_DEV_CODE_SEARCH` is one of `1`, `true`, `yes`, or `on`.
- The request has a valid manager PIN cookie.

If a model emits `code_search` while the flag is disabled or the caller lacks the PIN, the backend fails closed before invoking ripgrep.

## Invariants

- No runtime cloud API is introduced.
- Search query is passed to ripgrep after `--` and uses `--fixed-strings`.
- Result paths are relative to the repository root.
- Absolute, parent-traversal, and null-containing result paths are discarded.
- Optional globs must be relative and must not contain parent traversal.
- Audit payloads record `schemaVersion`, query length, optional glob, hit count, and truncation only; they do not store raw search text.

## Verification

Focused gate:

```bash
npm run test:dev-code-search
```

This covers:

- Pure tool gating before ripgrep.
- Relative path/result caps.
- Unsafe glob rejection.
- Route prompt discovery only for manager dev mode.
- Route execution, source recording, and redacted audit row.
- Cook-tier and disabled-env fail-closed behavior for hallucinated payloads.
