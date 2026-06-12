// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useEffect, useRef, useState } from 'react';

import { formatFdaCitation, formatUsdaCitation } from './citationHelpers';

const LOC_KEY = 'lariat_location';
const LANG_KEY = 'lariat_language';
const COOK_KEY = 'lariat_cook';
const CONVERSATION_SESSION_KEY = 'lariat_conversation_session_id';
const VOICE_INPUT_ERROR = 'Voice input stopped. Check the mic and try again.';

function fallbackUuidV4() {
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getOrCreateConversationSessionId() {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(CONVERSATION_SESSION_KEY);
  if (existing) return existing;
  const next = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : fallbackUuidV4();
  window.localStorage.setItem(CONVERSATION_SESSION_KEY, next);
  return next;
}

// Badge types backed by the data pack — clickable, expand inline to
// show the actual cited rows. Other badge types (eighty_six,
// inventory, signoffs, line_checks, recipes, food_safety…) stay as
// plain text labels per Task D acceptance criteria #5.
const DATAPACK_BADGE_TYPES = new Set(['fda_food_code', 'usda_ingredients']);

// Badge cache key — meta is rebuilt per submit, so type alone scopes
// the cache to the lifetime of one assistant answer. (We reset
// citations on every fresh submit anyway.)
function badgeCacheKey(type) {
  return type;
}

// Resolve `op=hybrid&bucket=…` hits + their per-row follow-ups into
// the citation payload the UI renders. Fan-out is bounded to the top
// `limit` hits; follow-up failures are absorbed (we still surface the
// hit with an empty body / no nutrients) so a single 500 doesn't
// poison the whole drill-in.
async function resolveFdaCitations(question, signal) {
  const params = new URLSearchParams({
    op: 'hybrid',
    q: question,
    bucket: 'safety',
    limit: '3',
  });
  const res = await fetch(`/api/datapack/search?${params.toString()}`, {
    signal,
  });
  if (res.status === 503) return { status: 'unavailable' };
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* fall through */
  }
  if (!res.ok || !body || !Array.isArray(body.hits)) {
    const msg =
      (body && typeof body.error === 'string' && body.error) ||
      `HTTP ${res.status}`;
    return { status: 'error', message: msg };
  }
  // Hybrid hits are heterogeneous (FTS envelope vs semantic envelope).
  // We accept both — formatFdaCitation collapses the shape.
  const hits = body.hits.filter(
    (h) =>
      h && (h.source === 'fda' || h.source === 'fda_food_code' || h.rowid != null || h.id != null)
  );
  // Fan-out the section follow-ups in parallel. allSettled keeps a
  // partial render when some succeed and some fail.
  const followUps = await Promise.allSettled(
    hits.map((h) => {
      const rowid = h.rowid ?? h.id;
      if (rowid === null || rowid === undefined) {
        return Promise.resolve(null);
      }
      const url = `/api/datapack/search?op=fda_section&rowid=${encodeURIComponent(
        String(rowid)
      )}`;
      return fetch(url, { signal }).then((r) =>
        r.ok ? r.json() : null
      );
    })
  );
  const citations = hits.map((h, i) => {
    const settled = followUps[i];
    const sectionRow =
      settled.status === 'fulfilled' && settled.value && settled.value.section
        ? settled.value.section
        : null;
    return formatFdaCitation(h, sectionRow);
  });
  return { status: 'ok', citations };
}

async function resolveUsdaCitations(question, signal) {
  const params = new URLSearchParams({
    op: 'hybrid',
    q: question,
    bucket: 'ingredients',
    limit: '3',
  });
  const res = await fetch(`/api/datapack/search?${params.toString()}`, {
    signal,
  });
  if (res.status === 503) return { status: 'unavailable' };
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* fall through */
  }
  if (!res.ok || !body || !Array.isArray(body.hits)) {
    const msg =
      (body && typeof body.error === 'string' && body.error) ||
      `HTTP ${res.status}`;
    return { status: 'error', message: msg };
  }
  const hits = body.hits.filter(
    (h) => h && (h.source === 'usda' || h.fdc_id != null || h.id != null)
  );
  const followUps = await Promise.allSettled(
    hits.map((h) => {
      const fdcId = h.fdc_id ?? h.id;
      if (fdcId === null || fdcId === undefined) {
        return Promise.resolve(null);
      }
      const url = `/api/datapack/search?op=usda_food&fdc_id=${encodeURIComponent(
        String(fdcId)
      )}`;
      return fetch(url, { signal }).then((r) => (r.ok ? r.json() : null));
    })
  );
  const citations = hits.map((h, i) => {
    const settled = followUps[i];
    const payload =
      settled.status === 'fulfilled' && settled.value ? settled.value : null;
    const foodRow = payload && payload.food ? payload.food : null;
    const nutrients = payload && payload.nutrients ? payload.nutrients : null;
    return formatUsdaCitation(h, foodRow, nutrients);
  });
  return { status: 'ok', citations };
}

function parseUndoExpiryMs(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function buildUndoStateFromResponse(data) {
  const undo = data?.undo;
  if (!undo || typeof undo !== 'object') return null;
  const expiresAtMs = parseUndoExpiryMs(undo.expires_at);
  if (!expiresAtMs || expiresAtMs <= Date.now()) return null;
  const label = typeof undo.label === 'string' ? undo.label.trim() : '';
  if (!label) return null;
  const auditEventId = Number(undo.audit_event_id);
  if (!Number.isInteger(auditEventId) || auditEventId <= 0) return null;
  const locationId = typeof data?.location_id === 'string' && data.location_id.trim()
    ? data.location_id.trim()
    : 'default';
  return {
    status: 'ready',
    label,
    auditEventId,
    expiresAtMs,
    locationId,
    message: '',
  };
}
export default function KitchenAssistantClient({ locQuery: _locQuery }) {
  const [ollamaOk, setOllamaOk] = useState(null);
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [meta, setMeta] = useState(null);
  // Question that produced the current `answer` / `meta` — captured at
  // submit time so badge clicks have a stable `q` even after the user
  // edits the textarea for their next question.
  const [askedQuestion, setAskedQuestion] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('English');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [SpeechRec, setSpeechRec] = useState(null);
  const recognitionRef = useRef(null);
  // Per-badge drill-in state, keyed by badge type. Shape:
  //   { status: 'loading' | 'ok' | 'error' | 'unavailable' | 'closed',
  //     citations?: [...], message?: string }
  // 'closed' is only ever the result of an explicit collapse — we keep
  // the cached payload on the entry so a second click re-opens without
  // a re-fetch (acceptance criteria #4).
  const [badgeState, setBadgeState] = useState({});
  // AbortController for the in-flight badge fan-out, scoped per badge
  // so a click on the FDA badge doesn't cancel an in-flight USDA fetch
  // and vice versa.
  const badgeAbortRef = useRef({});
  const [undoState, setUndoState] = useState(null);
  const [undoNowMs, setUndoNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLang = window.localStorage.getItem(LANG_KEY);
      if (savedLang) setLanguage(savedLang);
      
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        setSpeechSupported(true);
        setSpeechRec(() => SR);
      }
    }

    fetch('/api/kitchen-assistant?ping=1')
      .then((r) => r.json())
      .then((d) => {
        setModel(d.model || '');
        setOllamaOk(d.ollamaReachable);
      })
      .catch(() => {
        setOllamaOk(false);
      });
  }, []);

  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!undoState || undoState.status !== 'ready') return undefined;
    const tick = () => setUndoNowMs(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    const timeout = window.setTimeout(() => {
      setUndoState((current) => (current && current.status === 'ready' ? null : current));
    }, Math.max(0, undoState.expiresAtMs - Date.now()));
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [undoState]);

  const stopListening = (e) => {
    e?.preventDefault?.();
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
  };

  const startListening = (e) => {
    e?.preventDefault?.();
    if (loading || !SpeechRec || recognitionRef.current) return;
    setErr('');

    try {
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognitionRef.current = recognition;

      recognition.onstart = () => setIsListening(true);
      recognition.onerror = (evt) => {
        console.error('Speech error:', evt);
        recognitionRef.current = null;
        setIsListening(false);
        setErr(VOICE_INPUT_ERROR);
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };
      recognition.onresult = (evt) => {
        const transcript = evt.results[0][0].transcript;
        setMessage(prev => (prev + ' ' + transcript).trim());
      };

      recognition.start();
    } catch (err) {
      console.error("Speech recognition fault:", err);
      recognitionRef.current = null;
      setIsListening(false);
      setErr(VOICE_INPUT_ERROR);
    }
  };

  const ignoreVoiceClick = (e) => {
    e.preventDefault();
  };

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const stopWhenHidden = () => {
      if (document.hidden) stopListening();
    };
    const stopWhenWindowBlurs = () => {
      stopListening();
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    window.addEventListener('blur', stopWhenWindowBlurs);
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden);
      window.removeEventListener('blur', stopWhenWindowBlurs);
    };
  }, []);

  const voiceKeyDown = (e) => {
    if (e.key === 'Escape') {
      stopListening(e);
      return;
    }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    startListening(e);
  };

  const voiceKeyUp = (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    stopListening(e);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setAnswer('');
    setMeta(null);
    setUndoState(null);
    const q = message.trim();
    if (!q) return;
    stopListening();
    // Reset badge drill-in state on every fresh submit — the cached
    // citations from the prior answer are no longer relevant.
    setBadgeState({});
    Object.values(badgeAbortRef.current).forEach((c) => c?.abort());
    badgeAbortRef.current = {};
    setAskedQuestion(q);
    setLoading(true);
    try {
      const loc = typeof window !== 'undefined' ? window.localStorage.getItem(LOC_KEY) : '';
      const cookId = typeof window !== 'undefined' ? window.localStorage.getItem(COOK_KEY) : '';
      const body = {
        message: q,
        language,
        conversation_session_id: getOrCreateConversationSessionId(),
      };
      if (cookId) body.cook_id = cookId;
      if (loc && loc !== 'default') body.location_id = loc;
      const res = await fetch('/api/kitchen-assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Couldn't get an answer. Try again.");
        return;
      }
      setAnswer(data.answer || '');
      setMeta({
        latencyMs: data.latencyMs,
        model: data.model,
        sources: data.sources,
        disclaimer: data.disclaimer,
      });
      setUndoNowMs(Date.now());
      setUndoState(buildUndoStateFromResponse(data));
    } catch (ce) {
      setErr(String(ce.message || ce));
    } finally {
      setLoading(false);
    }
  };

  // Undo the last assistant write action. POSTs the audit row id back
  // to /api/kitchen-assistant/undo, which reverses the visible write and
  // records an append-only `correction` audit row (slice 2.7).
  const performUndo = async () => {
    if (!undoState || undoState.status !== 'ready') return;
    const { auditEventId, locationId, label } = undoState;
    setUndoState({ ...undoState, status: 'pending' });
    try {
      const cookId = typeof window !== 'undefined' ? window.localStorage.getItem(COOK_KEY) : '';
      const body = { undo_audit_id: auditEventId };
      if (locationId && locationId !== 'default') body.location_id = locationId;
      if (cookId) body.cook_id = cookId;
      const res = await fetch('/api/kitchen-assistant/undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUndoState({
          status: 'error',
          label,
          message: data.error || "Couldn't undo that.",
        });
        return;
      }
      setUndoState({
        status: 'done',
        label,
        message: data.message || 'Undid last action.',
      });
    } catch (ue) {
      setUndoState({
        status: 'error',
        label,
        message: String(ue?.message || ue),
      });
    }
  };

  const undoSecondsLeft =
    undoState && undoState.status === 'ready'
      ? Math.max(0, Math.ceil((undoState.expiresAtMs - undoNowMs) / 1000))
      : 0;

  // Cleanup any pending badge fan-outs on unmount so we don't leak
  // requests if the user navigates mid-fetch.
  useEffect(() => {
    return () => {
      Object.values(badgeAbortRef.current).forEach((c) => c?.abort());
      badgeAbortRef.current = {};
    };
  }, []);

  const toggleBadge = async (type) => {
    if (!DATAPACK_BADGE_TYPES.has(type)) return;
    const key = badgeCacheKey(type);
    const current = badgeState[key];

    // Already resolved — toggle collapse without a re-fetch.
    //
    //   ok          → cached payload is valid; flip the open/closed bit
    //                 (acceptance criteria #4: cache resolved payload).
    //   unavailable → the data pack stays unmounted on this server;
    //                 a re-fetch wouldn't help, so just toggle the
    //                 hint visibility.
    //   error       → fall through to the fresh-fetch path below so a
    //                 transient 500 doesn't strand the badge in a state
    //                 that needs a page refresh to recover from.
    if (current && (current.status === 'ok' || current.status === 'unavailable')) {
      setBadgeState((prev) => ({
        ...prev,
        [key]: { ...current, collapsed: !current.collapsed },
      }));
      return;
    }

    // Already loading — second click cancels and collapses.
    if (current && current.status === 'loading') {
      badgeAbortRef.current[key]?.abort();
      delete badgeAbortRef.current[key];
      setBadgeState((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const q = askedQuestion.trim();
    if (!q) return;

    // Fresh fetch — also the retry path for an errored badge. Abort any
    // controller still associated with this key (defensive: the prior
    // failed attempt should have already cleared its own ref in the
    // catch handler, but if a stale controller leaked we cancel it
    // before installing the new one).
    badgeAbortRef.current[key]?.abort();
    const ctrl = new AbortController();
    badgeAbortRef.current[key] = ctrl;
    setBadgeState((prev) => ({ ...prev, [key]: { status: 'loading' } }));

    try {
      const result =
        type === 'fda_food_code'
          ? await resolveFdaCitations(q, ctrl.signal)
          : await resolveUsdaCitations(q, ctrl.signal);
      // If a newer click superseded this fetch (or unmount aborted),
      // bail without writing stale state.
      if (ctrl.signal.aborted) return;
      if (badgeAbortRef.current[key] === ctrl) {
        delete badgeAbortRef.current[key];
      }
      setBadgeState((prev) => ({ ...prev, [key]: { ...result, collapsed: false } }));
    } catch (e) {
      if (e?.name === 'AbortError') return;
      if (badgeAbortRef.current[key] === ctrl) {
        delete badgeAbortRef.current[key];
      }
      setBadgeState((prev) => ({
        ...prev,
        [key]: { status: 'error', message: String(e?.message || e), collapsed: false },
      }));
    }
  };

  return (
    <>
      {ollamaOk === false && (
        <div className="card mb-16 border-red" role="alert" aria-live="assertive">
          <strong>AI is down.</strong> Can't connect to Ollama on the office Mac. Ask a manager to start it.
        </div>
      )}

      <form
        onSubmit={submit}
        className="card mb-20"
        aria-busy={loading}
        aria-describedby={err ? 'ka-err' : undefined}
      >
        <div className="flex justify-between items-center mb-12">
          <label htmlFor="ka-q" className="label m-0">
            Ask a question
          </label>
          <label htmlFor="ka-lang" className="sr-only">Answer language</label>
          <select
            id="ka-lang"
            name="ka-lang"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              if (typeof window !== 'undefined') window.localStorage.setItem(LANG_KEY, e.target.value);
            }}
            className="input w-auto"
            aria-label="Answer language"
          >
            <option value="English">English</option>
            <option value="Spanish">Español</option>
            <option value="French">Français</option>
            <option value="Tagalog">Tagalog</option>
            <option value="Kenyan Swahili">Swahili (Kenya)</option>
          </select>
        </div>
        <textarea
          id="ka-q"
          name="ka-q"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setErr((prev) => (prev === VOICE_INPUT_ERROR ? '' : prev));
          }}
          rows={4}
          placeholder="ex: What's 86? How much aji prep? Dairy in the dressing?"
          className="input mb-12"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={2000}
          aria-required="true"
          aria-invalid={!!err}
          aria-describedby={err ? 'ka-err' : undefined}
        />
        <div className="flex-center-gap" role="group" aria-label="Kitchen assistant controls">
          <button
            type="submit"
            className="btn primary"
            disabled={loading || !message.trim()}
            aria-label={loading ? 'Waiting for answer' : 'Ask kitchen assistant'}
          >
            {loading ? 'Wait...' : 'Ask'}
          </button>
          {speechSupported && (
            <button
              type="button"
              onClick={ignoreVoiceClick}
              onPointerDown={startListening}
              onPointerUp={stopListening}
              onPointerLeave={stopListening}
              onPointerCancel={stopListening}
              onBlur={stopListening}
              onKeyDown={voiceKeyDown}
              onKeyUp={voiceKeyUp}
              className={`btn ${isListening ? 'red' : ''}`}
              disabled={loading}
              aria-pressed={isListening}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            >
              {isListening ? 'Release 🎤' : 'Hold 🎤'}
            </button>
          )}
          {model && (
            <span className="meta" aria-label={`Model: ${model}`}>
              Model: <code>{model}</code>
            </span>
          )}
        </div>
        {isListening && (
          <span className="sr-only" role="status" aria-live="polite">Listening for voice input</span>
        )}
      </form>

      {err && (
        <div id="ka-err" className="card border-red mb-16" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      {undoState && (
        <div className="card mb-16" role="status" aria-live="polite" aria-label="Undo last action card">
          {undoState.status === 'ready' && (
            <div className="flex justify-between items-center">
              <div>
                <div>{undoState.label}</div>
                <div className="meta">{undoSecondsLeft}s to undo</div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={performUndo}
                aria-label="Undo last action"
              >
                Undo
              </button>
            </div>
          )}
          {undoState.status === 'pending' && <span>Undoing…</span>}
          {undoState.status === 'done' && <span>{undoState.message}</span>}
          {undoState.status === 'error' && (
            <span className="text-ember-deep">{undoState.message}</span>
          )}
        </div>
      )}

      {answer && (
        <div className="card" role="region" aria-labelledby="ka-answer-h" aria-live="polite">
          <h2 className="section-head mb-12" id="ka-answer-h">Answer</h2>
          <div className="assistant-answer">{answer}</div>
          {meta?.latencyMs != null && (
            <p className="meta mt-16" aria-label={`Response time ${meta.latencyMs} milliseconds, model ${meta.model}`}>
              {meta.latencyMs} ms · {meta.model}
            </p>
          )}
          {meta?.sources && meta.sources.length > 0 && (
            <details className="mt-12" open>
              <summary className="meta cursor-pointer">Books checked</summary>
              <ul className="meta mt-8 list-none p-0">
                {meta.sources.map((s) => {
                  const isClickable = DATAPACK_BADGE_TYPES.has(s.type);
                  const key = `${s.type}-${s.detail}`;
                  if (!isClickable) {
                    return (
                      <li key={key}>
                        <strong>{s.type}</strong>: {s.detail}
                      </li>
                    );
                  }
                  const cacheKey = badgeCacheKey(s.type);
                  const drill = badgeState[cacheKey];
                  const open = drill && !drill.collapsed && (drill.status === 'ok' || drill.status === 'error' || drill.status === 'unavailable' || drill.status === 'loading');
                  return (
                    <li key={key} className="mb-6">
                      <button
                        type="button"
                        onClick={() => toggleBadge(s.type)}
                        aria-expanded={Boolean(open)}
                        aria-label={
                          s.type === 'fda_food_code'
                            ? 'Show FDA Food Code citations'
                            : 'Show USDA ingredient citations'
                        }
                        className={`ka-badge-toggle${open ? ' is-open' : ''}`}
                      >
                        <strong>{s.type}</strong>: {s.detail}
                        <span aria-hidden="true" className="ml-6 text-muted">
                          {open ? '▾' : '▸'}
                        </span>
                      </button>
                      {open && (
                        <CitationDrillIn type={s.type} state={drill} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          {meta?.disclaimer && (
            <p className="meta text-yellow border-top mt-16" role="note">
              Check tags with a manager. Do not trust AI for allergies.
            </p>
          )}
        </div>
      )}
    </>
  );
}

// ── Citation drill-in panel ─────────────────────────────────────
//
// Rendered inline below an expanded data-pack badge. The state is the
// per-badge drill-in entry (see badgeState in KitchenAssistantClient):
// loading / error / unavailable / ok-with-citations. Hits get rendered
// in priority order — FDA shows section_id + chapter/annex + body
// excerpt; USDA shows description + food_category + nutrient line.

function CitationDrillIn({ type, state }) {
  if (!state) return null;
  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="ka-citation-wrap text-muted">
        {type === 'fda_food_code'
          ? 'Fetching FDA citations…'
          : 'Fetching USDA citations…'}
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <div role="alert" className="ka-citation-wrap text-muted">
        Data pack not available on this server.
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="ka-citation-wrap text-ember-deep">
        Couldn't load citations
        {state.message ? `: ${state.message}` : '.'}
      </div>
    );
  }
  if (state.status !== 'ok' || !Array.isArray(state.citations)) return null;
  if (state.citations.length === 0) {
    return (
      <div className="ka-citation-wrap text-muted">
        No citations matched.
      </div>
    );
  }
  if (type === 'fda_food_code') {
    return (
      <div className="ka-citation-wrap">
        {state.citations.map((c, i) => (
          <FdaCitationRow key={`${c.rowid ?? i}`} citation={c} />
        ))}
      </div>
    );
  }
  return (
    <div className="ka-citation-wrap">
      {state.citations.map((c, i) => (
        <UsdaCitationRow key={`${c.fdcId ?? i}`} citation={c} />
      ))}
    </div>
  );
}

function FdaCitationRow({ citation }) {
  const { title, sectionId, chapter, annex, excerpt } = citation;
  return (
    <div className="mb-10">
      <div className="fw-600">{title || '(no title)'}</div>
      <div className="text-muted fs-11">
        {sectionId ? <code>{sectionId}</code> : null}
        {sectionId && (chapter || annex) ? ' · ' : ''}
        {chapter ? `Ch. ${chapter}` : ''}
        {chapter && annex ? ' · ' : ''}
        {annex ? `Annex ${annex}` : ''}
      </div>
      {excerpt ? (
        <div className="mt-4 whitespace-pre-wrap">{excerpt}</div>
      ) : (
        <div className="mt-4 text-muted">
          (body unavailable)
        </div>
      )}
    </div>
  );
}

function UsdaCitationRow({ citation }) {
  const { description, foodCategory, fdcId, brandOwner, nutrients } = citation;
  return (
    <div className="mb-10">
      <div className="fw-600">{description || '(no description)'}</div>
      <div className="text-muted fs-11">
        {fdcId != null ? <code>fdc_id {fdcId}</code> : null}
        {foodCategory ? ` · ${foodCategory}` : ''}
        {brandOwner ? ` · ${brandOwner}` : ''}
      </div>
      {nutrients.length > 0 ? (
        <div className="mt-4">
          {nutrients
            .map(
              (n) =>
                `${n.displayName} ${n.amount}${n.displayUnit ? ` ${n.displayUnit}` : ''}`
            )
            .join(' · ')}
        </div>
      ) : (
        <div className="mt-4 text-muted">
          (no nutrients)
        </div>
      )}
    </div>
  );
}
