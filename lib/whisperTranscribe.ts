// Local Whisper ASR — server-side, opt-in via LARIAT_WHISPER=1.
//
// Mirrors the lib/datapackSearch.ts transformers pattern: lazy
// `pipeline()` build cached in a module promise (concurrent first
// callers share one load), failure resets the cache so the next call
// retries, and a prewarm hook keeps first-use latency off the cook's
// hold-to-talk release.
//
// Why opt-in: the model (~75 MB, whisper-tiny ONNX) downloads from the
// Hugging Face hub on first use. The repo's offline-first/test-release
// posture means that download must be an operator decision
// (docs/OPERATIONS_HANDOFF.md §6), not a boot side effect. Without the
// flag the kitchen-assistant composer falls back to the on-device Web
// Speech API exactly as before.
//
// Model id: transformers.js loads ONNX weights — `onnx-community/
// whisper-tiny` is the maintained conversion of openai/whisper-tiny
// (multilingual, so the composer's language picker can hint es/fr/…).

// Whisper models are trained on 16 kHz mono audio.
export const WHISPER_SAMPLE_RATE = 16000;

const _WHISPER_MODEL_ID = 'onnx-community/whisper-tiny';

type AsrPipeline = (
  _audio: Float32Array,
  _opts: object,
) => Promise<{ text: string }>;

let _pipelinePromise: Promise<AsrPipeline> | null = null;
let _pipelineOverride: AsrPipeline | null = null;

export function isWhisperEnabled(): boolean {
  return process.env.LARIAT_WHISPER === '1';
}

function loadPipeline(): Promise<AsrPipeline> {
  if (_pipelinePromise) return _pipelinePromise;
  const promise = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const asr = (await pipeline(
      'automatic-speech-recognition',
      _WHISPER_MODEL_ID,
    )) as unknown as AsrPipeline;
    return asr;
  })();
  _pipelinePromise = promise;
  promise.catch(() => {
    if (_pipelinePromise === promise) _pipelinePromise = null;
  });
  return promise;
}

/** Composer picker labels → Whisper language hints. Unknown → undefined
 *  (Whisper auto-detects). */
const LANGUAGE_HINTS: Record<string, string> = {
  English: 'en',
  Spanish: 'es',
  French: 'fr',
  Tagalog: 'tl',
  'Kenyan Swahili': 'sw',
};

export function whisperLanguageHint(pickerValue: unknown): string | undefined {
  if (typeof pickerValue !== 'string') return undefined;
  return LANGUAGE_HINTS[pickerValue.trim()];
}

/**
 * Parse a 16 kHz mono WAV (PCM16 or IEEE float32) into the Float32Array
 * Whisper expects. Strict on format — the client encodes exactly this
 * shape (see KitchenAssistantClient hold-to-talk), so anything else is
 * a caller bug worth a 400, not silent resampling on the server.
 */
export function parseWavToFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength < 44) throw new Error('wav too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off: number) =>
    String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    );
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');

  // Walk chunks — fmt may not be at the fixed offset if an encoder adds
  // extension chunks.
  let off = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      format = view.getUint16(off + 8, true);
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bitsPerSample = view.getUint16(off + 22, true);
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = Math.min(size, bytes.byteLength - dataOff);
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (dataOff < 0) throw new Error('wav has no data chunk');
  if (channels !== 1) throw new Error(`wav must be mono (got ${channels} channels)`);
  if (sampleRate !== WHISPER_SAMPLE_RATE) {
    throw new Error(`wav must be ${WHISPER_SAMPLE_RATE} Hz (got ${sampleRate})`);
  }

  if (format === 1 && bitsPerSample === 16) {
    const n = Math.floor(dataLen / 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      out[i] = view.getInt16(dataOff + i * 2, true) / 32768;
    }
    return out;
  }
  if (format === 3 && bitsPerSample === 32) {
    const n = Math.floor(dataLen / 4);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      out[i] = view.getFloat32(dataOff + i * 4, true);
    }
    return out;
  }
  throw new Error(`unsupported wav format (format=${format}, bits=${bitsPerSample})`);
}

/**
 * Transcribe 16 kHz mono PCM. `language` is a Whisper hint ('es', …);
 * undefined lets the model auto-detect. Throws when the flag is off —
 * the route turns that into its 503.
 */
export async function transcribe(
  pcm: Float32Array,
  language?: string,
): Promise<string> {
  if (!isWhisperEnabled()) {
    throw new Error('whisper disabled — set LARIAT_WHISPER=1');
  }
  const asr = _pipelineOverride ?? (await loadPipeline());
  const opts: Record<string, unknown> = { task: 'transcribe' };
  if (language) opts.language = language;
  const result = await asr(pcm, opts);
  return typeof result?.text === 'string' ? result.text.trim() : '';
}

/**
 * Boot-time prewarm (instrumentation.ts). No-op unless the operator
 * opted in; failures are logged, never thrown — same graceful posture
 * as prewarmDataPack.
 */
export async function prewarmWhisper(): Promise<void> {
  if (!isWhisperEnabled()) return;
  try {
    await loadPipeline();
    console.info('[whisper] model prewarmed');
  } catch (err) {
    console.warn('[whisper] prewarm failed (will retry on first use):', err);
  }
}

/** Test-only: inject a fake ASR pipeline (pass null to clear). */
export function _setPipelineForTest(fn: AsrPipeline | null): void {
  _pipelineOverride = fn;
}

/** Test-only: drop the cached model promise. */
export function _resetForTest(): void {
  _pipelinePromise = null;
  _pipelineOverride = null;
}
