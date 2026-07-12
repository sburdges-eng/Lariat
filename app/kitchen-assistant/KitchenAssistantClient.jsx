// @ts-check
'use client';

import { useEffect, useRef, useState } from 'react';

import { formatFdaCitation, formatUsdaCitation } from './citationHelpers';
import { useLocation } from '../_components/useLocation';

/** @typedef {import('../../lib/kitchenAssistantContext.ts').ContextSource} ContextSource */
/** @typedef {import('../../lib/kitchenAssistantUndo.ts').KitchenAssistantUndoMeta} KitchenAssistantUndoMeta */
/** @typedef {import('../../lib/datapackSearch.ts').FdaSection} FdaSection */
/** @typedef {import('../../lib/datapackSearch.ts').UsdaFood} UsdaFood */
/** @typedef {import('../../lib/datapackSearch.ts').UsdaNutrient} UsdaNutrient */

// ── /api/kitchen-assistant contract ─────────────────────────────────

/**
 * @typedef {{
 *   answer?: string;
 *   error?: string;
 *   model?: string;
 *   location_id?: string;
 *   sources?: ContextSource[];
 *   latencyMs?: number;
 *   disclaimer?: string;
 *   undo?: KitchenAssistantUndoMeta | null;
 * }} KitchenAssistantResponse
 */

/**
 * @typedef {{
 *   latencyMs?: number;
 *   model?: string;
 *   sources?: ContextSource[];
 *   disclaimer?: string;
 * }} AnswerMeta
 */

// ── Undo card state (slice 2.7) ──────────────────────────────────────

/**
 * @typedef {{
 *   status: 'ready' | 'pending';
 *   label: string;
 *   auditEventId: number;
 *   expiresAtMs: number;
 *   locationId: string;
 *   message: string;
 * }} UndoLiveState
 */
/** @typedef {{ status: 'done' | 'error'; label: string; message: string }} UndoSettledState */
/** @typedef {UndoLiveState | UndoSettledState | null} UndoState */

// ── /api/datapack/search hit + follow-up shapes ──────────────────────
//
// A hybrid hit rides along as either the FTS envelope (source, id,
// title, subtitle, extra) or the semantic envelope (per-source metadata
// fields verbatim: rowid/section_id/chapter/annex for FDA, fdc_id for
// USDA) — see lib/datapackSearch.ts `HybridHit`. We read defensively
// across both shapes, so every field here is optional.

/** @typedef {import('./citationHelpers.js').DataPackHit} DatapackHit */

/** @typedef {{ section?: FdaSection }} FdaSectionFollowUp */
/** @typedef {{ food?: UsdaFood; nutrients?: UsdaNutrient[] }} UsdaFoodFollowUp */

// ── Citation display shapes (mirror citationHelpers.js's return values) ──

/**
 * @typedef {{
 *   title: string;
 *   sectionId: string;
 *   chapter: string;
 *   annex: string;
 *   rowid: number | null;
 *   excerpt: string;
 * }} FdaCitation
 */

/**
 * @typedef {{
 *   nutrient_id?: number;
 *   nutrient_name?: string | null;
 *   amount?: number | null;
 *   unit_name?: string | null;
 *   displayName: string;
 *   displayUnit: string;
 * }} UsdaNutrientDisplay
 */

/**
 * @typedef {{
 *   description: string;
 *   foodCategory: string;
 *   fdcId: number | null;
 *   brandOwner: string;
 *   nutrients: UsdaNutrientDisplay[];
 * }} UsdaCitation
 */

/** @typedef {{ status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ok'; citations: FdaCitation[] }} FdaCitationResult */
/** @typedef {{ status: 'unavailable' } | { status: 'error'; message: string } | { status: 'ok'; citations: UsdaCitation[] }} UsdaCitationResult */

// ── Badge drill-in state, keyed by badge type ────────────────────────

/**
 * @typedef {
 *   | { status: 'loading' }
 *   | { status: 'ok'; citations: (FdaCitation | UsdaCitation)[]; collapsed: boolean }
 *   | { status: 'unavailable'; collapsed: boolean }
 *   | { status: 'error'; message: string; collapsed: boolean }
 * } BadgeEntry
 */

// ── Local-Whisper capture handle ─────────────────────────────────────

/**
 * @typedef {{
 *   stream: MediaStream;
 *   ctx: AudioContext;
 *   source: MediaStreamAudioSourceNode;
 *   processor: ScriptProcessorNode;
 *   chunks: Float32Array[];
 *   sampleRate: number;
 * }} WhisperCapture
 */

// ── Web Speech API (not in lib.dom.d.ts — declared locally) ──────────

/** @typedef {{ transcript: string }} SpeechRecognitionAlternative */
/** @typedef {{ 0: SpeechRecognitionAlternative }} SpeechRecognitionResult */
/** @typedef {{ results: { 0: SpeechRecognitionResult } }} SpeechRecognitionResultEvent */
/** @typedef {{ error?: string }} SpeechRecognitionErrorEvent */

/**
 * @typedef {{
 *   continuous: boolean;
 *   interimResults: boolean;
 *   start: () => void;
 *   stop: () => void;
 *   abort: () => void;
 *   onstart: (() => void) | null;
 *   onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
 *   onend: (() => void) | null;
 *   onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
 * }} SpeechRecognitionInstance
 */
/** @typedef {new () => SpeechRecognitionInstance} SpeechRecognitionCtor */
/**
 * @typedef {Window & typeof globalThis & {
 *   SpeechRecognition?: SpeechRecognitionCtor;
 *   webkitSpeechRecognition?: SpeechRecognitionCtor;
 *   webkitAudioContext?: typeof AudioContext;
 * }} SpeechCapableWindow
 */

const LANG_KEY = 'lariat_language';
const COOK_KEY = 'lariat_cook';
const CONVERSATION_SESSION_KEY = 'lariat_conversation_session_id';
const VOICE_INPUT_ERROR = 'Voice input stopped. Check the mic and try again.';

/** @param {unknown} err @returns {string} */
function stringifyError(err) {
  const withMessage = /** @type {{ message?: unknown } | null} */ (
    err && typeof err === 'object' ? err : null
  );
  return String((withMessage && withMessage.message) || err);
}

function fallbackUuidV4() {
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (/** @type {number} */ (bytes[6]) & 0x0f) | 0x40;
  bytes[8] = (/** @type {number} */ (bytes[8]) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** @returns {string} */
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
/** @param {string} type @returns {string} */
function badgeCacheKey(type) {
  return type;
}

// Resolve `op=hybrid&bucket=…` hits + their per-row follow-ups into
// the citation payload the UI renders. Fan-out is bounded to the top
// `limit` hits; follow-up failures are absorbed (we still surface the
// hit with an empty body / no nutrients) so a single 500 doesn't
// poison the whole drill-in.
/**
 * @param {string} question
 * @param {AbortSignal} signal
 * @returns {Promise<FdaCitationResult>}
 */
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
  /** @type {{ hits?: unknown; error?: unknown } | null} */
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
  const rawHits = /** @type {DatapackHit[]} */ (body.hits);
  const hits = rawHits.filter(
    (h) =>
      h && (h.source === 'fda' || h.source === 'fda_food_code' || h.rowid != null || h.id != null)
  );
  // Fan-out the section follow-ups in parallel. allSettled keeps a
  // partial render when some succeed and some fail.
  const followUps = await Promise.allSettled(
    hits.map((h) => {
      const rowid = h.rowid ?? h.id;
      if (rowid === null || rowid === undefined) {
        return Promise.resolve(/** @type {FdaSectionFollowUp | null} */ (null));
      }
      const url = `/api/datapack/search?op=fda_section&rowid=${encodeURIComponent(
        String(rowid)
      )}`;
      return fetch(url, { signal }).then((r) =>
        r.ok ? /** @type {Promise<FdaSectionFollowUp | null>} */ (r.json()) : null
      );
    })
  );
  const citations = hits.map((h, i) => {
    const settled = /** @type {PromiseSettledResult<FdaSectionFollowUp | null>} */ (followUps[i]);
    const sectionRow =
      settled.status === 'fulfilled' && settled.value && settled.value.section
        ? settled.value.section
        : null;
    return /** @type {FdaCitation} */ (formatFdaCitation(h, sectionRow));
  });
  return { status: 'ok', citations };
}

/**
 * @param {string} question
 * @param {AbortSignal} signal
 * @returns {Promise<UsdaCitationResult>}
 */
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
  /** @type {{ hits?: unknown; error?: unknown } | null} */
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
  const rawHits = /** @type {DatapackHit[]} */ (body.hits);
  const hits = rawHits.filter(
    (h) => h && (h.source === 'usda' || h.fdc_id != null || h.id != null)
  );
  const followUps = await Promise.allSettled(
    hits.map((h) => {
      const fdcId = h.fdc_id ?? h.id;
      if (fdcId === null || fdcId === undefined) {
        return Promise.resolve(/** @type {UsdaFoodFollowUp | null} */ (null));
      }
      const url = `/api/datapack/search?op=usda_food&fdc_id=${encodeURIComponent(
        String(fdcId)
      )}`;
      return fetch(url, { signal }).then((r) => (r.ok ? /** @type {Promise<UsdaFoodFollowUp | null>} */ (r.json()) : null));
    })
  );
  const citations = hits.map((h, i) => {
    const settled = /** @type {PromiseSettledResult<UsdaFoodFollowUp | null>} */ (followUps[i]);
    const payload =
      settled.status === 'fulfilled' && settled.value ? settled.value : null;
    const foodRow = payload && payload.food ? payload.food : null;
    const nutrients = payload && payload.nutrients ? payload.nutrients : null;
    return /** @type {UsdaCitation} */ (formatUsdaCitation(h, foodRow, nutrients));
  });
  return { status: 'ok', citations };
}

/** @param {unknown} value @returns {number | null} */
function parseUndoExpiryMs(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {KitchenAssistantResponse} data
 * @returns {UndoState}
 */
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
// ── Local-Whisper hold-to-talk capture ──────────────────────────────
// When /api/transcribe reports enabled (LARIAT_WHISPER=1 server-side),
// the mic button records raw PCM via Web Audio instead of using the
// Web Speech API: capture at the device rate, downsample to Whisper's
// 16 kHz mono, encode PCM16 WAV, POST, append the transcript. Web
// Speech stays as the fallback so the probe failing (or the flag off)
// keeps today's behavior byte-identical.

const WHISPER_RATE = 16000;

// Composer picker labels → Whisper language hints (server auto-detects
// when the label is unknown).
/** @type {Record<string, string>} */
const WHISPER_LANGUAGE_HINTS = {
  English: 'en',
  Spanish: 'es',
  French: 'fr',
  Tagalog: 'tl',
  'Kenyan Swahili': 'sw',
};

/**
 * @param {Float32Array[]} chunks
 * @param {number} fromRate
 * @returns {Float32Array}
 */
function downsampleToWhisperRate(chunks, fromRate) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const joined = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    joined.set(c, off);
    off += c.length;
  }
  if (fromRate === WHISPER_RATE) return joined;
  const ratio = fromRate / WHISPER_RATE;
  const outLen = Math.floor(joined.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    // Nearest-sample decimation — fine for speech into whisper-tiny;
    // a windowed-sinc resampler is not worth the battery on an iPad.
    out[i] = /** @type {number} */ (joined[Math.floor(i * ratio)]);
  }
  return out;
}

/**
 * @param {Float32Array} pcm
 * @returns {ArrayBuffer}
 */
function encodeWavPcm16(pcm) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buf);
  /** @param {number} off @param {string} s */
  const writeTag = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WHISPER_RATE, true);
  view.setUint32(28, WHISPER_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, /** @type {number} */ (pcm[i])));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export default function KitchenAssistantClient() {
  const { locationId } = useLocation();
  const [ollamaOk, setOllamaOk] = useState(/** @type {boolean | null} */ (null));
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [meta, setMeta] = useState(/** @type {AnswerMeta | null} */ (null));
  // Question that produced the current `answer` / `meta` — captured at
  // submit time so badge clicks have a stable `q` even after the user
  // edits the textarea for their next question.
  const [askedQuestion, setAskedQuestion] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('English');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [SpeechRec, setSpeechRec] = useState(/** @type {SpeechRecognitionCtor | null} */ (null));
  const recognitionRef = useRef(/** @type {SpeechRecognitionInstance | null} */ (null));
  // Local-Whisper capture (see module helpers above). whisperEnabled is
  // the /api/transcribe probe result; probe failure leaves it false so
  // the Web Speech path is the default everywhere Whisper isn't set up.
  const [whisperEnabled, setWhisperEnabled] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const captureRef = useRef(/** @type {WhisperCapture | null} */ (null));
  // Per-badge drill-in state, keyed by badge type. Shape:
  //   { status: 'loading' | 'ok' | 'error' | 'unavailable' | 'closed',
  //     citations?: [...], message?: string }
  // 'closed' is only ever the result of an explicit collapse — we keep
  // the cached payload on the entry so a second click re-opens without
  // a re-fetch (acceptance criteria #4).
  const [badgeState, setBadgeState] = useState(/** @type {Record<string, BadgeEntry>} */ ({}));
  // AbortController for the in-flight badge fan-out, scoped per badge
  // so a click on the FDA badge doesn't cancel an in-flight USDA fetch
  // and vice versa.
  const badgeAbortRef = useRef(/** @type {Record<string, AbortController>} */ ({}));
  const [undoState, setUndoState] = useState(/** @type {UndoState} */ (null));
  const [undoNowMs, setUndoNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLang = window.localStorage.getItem(LANG_KEY);
      if (savedLang) setLanguage(savedLang);

      const w = /** @type {SpeechCapableWindow} */ (window);
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (SR) {
        setSpeechSupported(true);
        setSpeechRec(() => SR);
      }
    }

    fetch('/api/kitchen-assistant?ping=1')
      .then((r) => /** @type {Promise<{ model?: string; ollamaReachable?: boolean }>} */ (r.json()))
      .then((d) => {
        setModel(d.model || '');
        setOllamaOk(d.ollamaReachable ?? null);
      })
      .catch(() => {
        setOllamaOk(false);
      });

    fetch('/api/transcribe')
      .then((r) => (r.ok ? /** @type {Promise<{ enabled?: boolean }>} */ (r.json()) : null))
      .then((d) => setWhisperEnabled(Boolean(d?.enabled)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      // Unmount mid-capture: discard, don't transcribe (no state to land in).
      const cap = captureRef.current;
      if (cap) {
        captureRef.current = null;
        try {
          cap.processor.disconnect();
          cap.source.disconnect();
          cap.stream.getTracks().forEach((t) => t.stop());
          cap.ctx.close();
        } catch {
          /* best-effort teardown */
        }
      }
    };
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

  const finishWhisperCapture = () => {
    const cap = captureRef.current;
    if (!cap) return;
    captureRef.current = null;
    setIsListening(false);
    try {
      cap.processor.disconnect();
      cap.source.disconnect();
      cap.stream.getTracks().forEach((t) => t.stop());
      cap.ctx.close();
    } catch {
      /* best-effort teardown — transcribe whatever we captured */
    }
    const pcm = downsampleToWhisperRate(cap.chunks, cap.sampleRate);
    // Sub-0.1s holds are taps, not speech — skip the round-trip.
    if (pcm.length < WHISPER_RATE / 10) return;
    const hint = WHISPER_LANGUAGE_HINTS[language];
    const qs = hint ? `?language=${encodeURIComponent(hint)}` : '';
    setTranscribing(true);
    fetch(`/api/transcribe${qs}`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: encodeWavPcm16(pcm),
    })
      .then(async (r) => {
        const d = /** @type {{ transcript?: unknown } | null} */ (await r.json().catch(() => null));
        if (!r.ok || typeof d?.transcript !== 'string') throw new Error('transcribe failed');
        const t = d.transcript.trim();
        if (t) setMessage((prev) => (prev + ' ' + t).trim());
      })
      .catch((err) => {
        console.error('Whisper transcribe failed:', err);
        setErr(VOICE_INPUT_ERROR);
      })
      .finally(() => setTranscribing(false));
  };

  const startWhisperCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The pointer may already be up by the time the permission prompt
      // resolves — bail out instead of recording an unheld mic.
      if (captureRef.current || recognitionRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const w = /** @type {SpeechCapableWindow} */ (window);
      const Ctx = w.AudioContext || w.webkitAudioContext;
      if (!Ctx) throw new Error('AudioContext unavailable');
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor over AudioWorklet: deprecated but the only path
      // that works on every iPad Safari this kitchen runs.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      /** @type {Float32Array[]} */
      const chunks = [];
      processor.onaudioprocess = (evt) => {
        chunks.push(new Float32Array(evt.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      captureRef.current = { stream, ctx, source, processor, chunks, sampleRate: ctx.sampleRate };
      setIsListening(true);
    } catch (err) {
      console.error('Whisper capture fault:', err);
      captureRef.current = null;
      setIsListening(false);
      setErr(VOICE_INPUT_ERROR);
    }
  };

  /** @param {{ preventDefault?: () => void } | undefined} [e] */
  const stopListening = (e) => {
    e?.preventDefault?.();
    if (captureRef.current) {
      finishWhisperCapture();
      return;
    }
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
  };

  /** @param {{ preventDefault?: () => void } | undefined} [e] */
  const startListening = (e) => {
    e?.preventDefault?.();
    if (loading || transcribing || recognitionRef.current || captureRef.current) return;
    setErr('');

    if (whisperEnabled) {
      startWhisperCapture();
      return;
    }
    if (!SpeechRec) return;

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

  /** @param {React.MouseEvent<HTMLButtonElement>} e */
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

  /** @param {React.KeyboardEvent<HTMLButtonElement>} e */
  const voiceKeyDown = (e) => {
    if (e.key === 'Escape') {
      stopListening(e);
      return;
    }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    startListening(e);
  };

  /** @param {React.KeyboardEvent<HTMLButtonElement>} e */
  const voiceKeyUp = (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    stopListening(e);
  };

  /** @param {React.FormEvent<HTMLFormElement>} e */
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
      const cookId = typeof window !== 'undefined' ? window.localStorage.getItem(COOK_KEY) : '';
      /** @type {{ message: string; language: string; conversation_session_id: string; cook_id?: string; location_id?: string }} */
      const body = {
        message: q,
        language,
        conversation_session_id: getOrCreateConversationSessionId(),
      };
      if (cookId) body.cook_id = cookId;
      if (locationId && locationId !== 'default') body.location_id = locationId;
      const res = await fetch('/api/kitchen-assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = /** @type {KitchenAssistantResponse} */ (await res.json().catch(() => ({})));
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
      setErr(stringifyError(ce));
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
      /** @type {{ undo_audit_id: number; location_id?: string; cook_id?: string }} */
      const body = { undo_audit_id: auditEventId };
      if (locationId && locationId !== 'default') body.location_id = locationId;
      if (cookId) body.cook_id = cookId;
      const res = await fetch('/api/kitchen-assistant/undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = /** @type {{ error?: string; message?: string }} */ (await res.json().catch(() => ({})));
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
        message: stringifyError(ue),
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

  /** @param {string} type */
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
      if (/** @type {{ name?: unknown } | null} */ (e && typeof e === 'object' ? e : null)?.name === 'AbortError') return;
      if (badgeAbortRef.current[key] === ctrl) {
        delete badgeAbortRef.current[key];
      }
      setBadgeState((prev) => ({
        ...prev,
        [key]: { status: 'error', message: stringifyError(e), collapsed: false },
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
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(LANG_KEY, e.target.value);
                // Keep the v2 UI locale in step with the answer language —
                // Spanish answers + Spanish chrome, anything else → English
                // chrome until those catalogs exist (lib/i18n).
                const locale = e.target.value === 'Spanish' ? 'es' : 'en';
                document.cookie = `lariat_locale=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
              }
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
          {(speechSupported || whisperEnabled) && (
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
              disabled={loading || transcribing}
              aria-pressed={isListening}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            >
              {transcribing ? 'Hearing…' : isListening ? 'Release 🎤' : 'Hold 🎤'}
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
        {transcribing && (
          <span className="sr-only" role="status" aria-live="polite">Transcribing voice input</span>
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

/**
 * @param {{ type: string; state: BadgeEntry | undefined }} props
 */
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
    const citations = /** @type {FdaCitation[]} */ (state.citations);
    return (
      <div className="ka-citation-wrap">
        {citations.map((c, i) => (
          <FdaCitationRow key={`${c.rowid ?? i}`} citation={c} />
        ))}
      </div>
    );
  }
  const citations = /** @type {UsdaCitation[]} */ (state.citations);
  return (
    <div className="ka-citation-wrap">
      {citations.map((c, i) => (
        <UsdaCitationRow key={`${c.fdcId ?? i}`} citation={c} />
      ))}
    </div>
  );
}

/**
 * @param {{ citation: FdaCitation }} props
 */
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

/**
 * @param {{ citation: UsdaCitation }} props
 */
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
