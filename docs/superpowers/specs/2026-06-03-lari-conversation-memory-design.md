# LaRi Conversation Memory Design

Date: 2026-06-03
Scope: Kitchen Assistant conversation memory, roadmap item 2.1.

## Goal

Give LaRi a short, bounded conversation buffer so follow-up questions can refer to the immediately recent exchange without making prior model text authoritative. The feature is scoped to the Kitchen Assistant page and `POST /api/kitchen-assistant`.

## Non-goals

- No cloud API dependency or hosted AI service.
- No cross-location history lookup.
- No identity or authorization derived from `conversation_session_id` or `cook_id`.
- No manager-tier widening unless the current request has a valid signed PIN cookie.
- No unbounded transcript storage, summarization pass, semantic search, or new model behavior.

## Section 2: Data Flow And Boundaries

### Client request boundary

The client owns only a local conversation partition. On first use, `/kitchen-assistant` generates a UUID and stores it in browser-local storage. Every assistant request sends `conversation_session_id`. The client also sends `cook_id` from existing `lariat_cook` localStorage when present; otherwise it omits the cook value and the backend normalizes the request to `anonymous`.

The client-supplied `conversation_session_id` and `cook_id` are caller assertions. They help select a short history bucket, but they do not prove identity, select a location, grant manager access, or authorize a database query.

### Backend validation boundary

The backend validates, trims, and clips `conversation_session_id`, `cook_id`, and `message` before any database lookup or model call. Invalid or missing session IDs fail closed instead of falling into a shared history bucket. Missing or blank cook IDs normalize to `anonymous`.

Recommended caps:

- `conversation_session_id`: UUID string, clipped to 64 chars after validation.
- `cook_id`: string, clipped to 64 chars after trim.
- `message`: existing request cap remains authoritative.
- stored user and assistant content: fixed per-field char caps before insert and before prompt injection.

### History lookup boundary

On each assistant POST, the backend lazily deletes expired conversation rows before loading history. Default TTL is 8 hours. The query loads recent turns only where all partition fields match exactly:

```text
location_id = current request location
cook_id = normalized current request cook id
conversation_session_id = validated current request session id
```

History is bounded to the latest 6 completed turns, each content field clipped to the fixed cap. After selecting the latest rows, prompt injection orders them deterministically by `created_at ASC, id ASC`.

No cross-location reads are allowed. No manager-tier prior turns are loaded unless the current request has a valid signed PIN. The session ID is an opaque key, not authority.

### Authority boundary

Prior turns are injected as context only. They can help resolve follow-ups like "show me brisket specifically," but they are never a source of truth for operational claims. Live grounded context from `buildGroundedContext()` and vetted `db_query` results remain authoritative. If prior turns conflict with live context, live context wins.

The prompt should label prior turns explicitly as non-authoritative conversation context. The live `CONTEXT` block and the `db_query` catalog stay separate from history so the model cannot confuse remembered text with current facts.

### Storage boundary

Stored assistant content is the final user-visible answer returned to the client, not raw model output. Hidden JSON action payloads are stripped before storage. If a `db_query` executes, the stored assistant content is the final prose or table answer shown to the user, with raw model action JSON excluded.

Store only completed exchanges. A failed Ollama call, invalid request, or blocked request should not create a partial assistant turn. If a write action executes, store the final visible action result string that the user saw, preserving the existing audit tables as the authoritative record of mutation.

### Logical record schema

Canonical field order:

```text
schemaVersion
id
location_id
cook_id
conversation_session_id
user_content
assistant_content
manager_tier
created_at
expires_at
```

`schemaVersion` is a fixed string for the row contract, for example `lari_conversation_turn_v1`. The schema has no optional free-form maps. All variable text fields are clipped before persistence.

## Invariants

- Conversation rows are partitioned by exact `location_id`, `cook_id`, and `conversation_session_id`.
- Session ID and cook ID are never used as authorization.
- Missing cook normalizes to `anonymous`; missing or invalid session fails closed.
- Prior turns are context only; live grounded context and vetted `db_query` output are authoritative.
- Manager-tier history is available only when the current request has a valid signed PIN.
- Stored assistant content is final visible content, not hidden action JSON.
- Lazy sweep removes expired rows during each assistant POST.
- History injection is capped to 6 turns and deterministic by `created_at ASC, id ASC`.
- All stored and injected text is clipped to fixed caps.

## Test Design

Focused tests should cover:

1. Client sends a stable UUID `conversation_session_id` and existing `lariat_cook` when available.
2. Backend rejects invalid session IDs and normalizes missing cook to `anonymous`.
3. History lookup never crosses `location_id`, `cook_id`, or `conversation_session_id`.
4. Manager-tier history is excluded without a valid signed PIN.
5. Prior turns inject in deterministic order after latest-row selection.
6. Expired rows are deleted lazily during assistant POST.
7. Stored assistant content excludes raw JSON action payloads.
8. `db_query` and live grounded context remain the authoritative source in the prompt contract.

## Governance Impact

- Affected subsystem: Kitchen Assistant client and `POST /api/kitchen-assistant`.
- Freeze-readiness impact: bounded additive feature; requires migration plus focused route/client tests before freeze.
- Determinism impact: positive if implemented with fixed TTL, caps, ordering, and exact partition keys.
- Security impact: neutral to positive; no new authority is granted by session ID or cook ID, and manager-tier widening remains signed-PIN gated.
- Runtime coupling introduced: no cloud or hidden runtime coupling.
