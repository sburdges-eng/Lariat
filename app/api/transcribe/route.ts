// POST /api/transcribe — local Whisper ASR for the kitchen-assistant
// hold-to-talk composer. Body: raw 16 kHz mono WAV (audio/wav). Query:
// ?language=es (Whisper hint; omit to auto-detect). GET is the client's
// capability probe — `{ enabled }` decides Whisper capture vs the Web
// Speech fallback.
//
// Opt-in surface: 503 when LARIAT_WHISPER isn't set (same graceful-
// degrade shape as the datapack 503s) — the composer keeps working via
// the on-device Web Speech API. No PIN gate: same posture as the LLM
// ask endpoint it feeds, and the transcript only ever lands in the
// cook's own textarea.

import {
  isWhisperEnabled,
  parseWavToFloat32,
  transcribe,
} from '../../../lib/whisperTranscribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ enabled: isWhisperEnabled() });
}

export async function POST(req: Request) {
  if (!isWhisperEnabled()) {
    return Response.json(
      { error: 'voice transcription is disabled (set LARIAT_WHISPER=1)' },
      { status: 503 },
    );
  }

  let pcm: Float32Array;
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength === 0) {
      return Response.json({ error: 'empty audio body' }, { status: 400 });
    }
    // ~60s ceiling at 16 kHz/16-bit — hold-to-talk clips are seconds long;
    // anything bigger is a runaway capture, not a question.
    if (bytes.byteLength > 2_000_000) {
      return Response.json({ error: 'audio too long' }, { status: 413 });
    }
    pcm = parseWavToFloat32(bytes);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'invalid wav' },
      { status: 400 },
    );
  }

  try {
    const url = new URL(req.url);
    const language = url.searchParams.get('language') || undefined;
    const transcript = await transcribe(pcm, language);
    return Response.json({ transcript });
  } catch (err) {
    console.error('POST /api/transcribe failed:', err);
    return Response.json(
      { error: 'transcription unavailable' },
      { status: 503 },
    );
  }
}
