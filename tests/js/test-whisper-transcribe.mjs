#!/usr/bin/env node
// Local Whisper ASR — lib seams + /api/transcribe route contract.
// Run: node --experimental-strip-types --test tests/js/test-whisper-transcribe.mjs

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const {
  WHISPER_SAMPLE_RATE,
  isWhisperEnabled,
  parseWavToFloat32,
  transcribe,
  prewarmWhisper,
  whisperLanguageHint,
  _setPipelineForTest,
  _resetForTest,
} = await import('../../lib/whisperTranscribe.ts');
const { GET: transcribeGet, POST: transcribePost } = await import(
  '../../app/api/transcribe/route.ts'
);

/** Minimal 16 kHz mono PCM16 WAV around the given samples. */
function wavPcm16(samples, { rate = WHISPER_SAMPLE_RATE, channels = 1 } = {}) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const tag = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2 * channels, true);
  view.setUint16(32, 2 * channels, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buf);
}

const ORIG_FLAG = process.env.LARIAT_WHISPER;

beforeEach(() => {
  _resetForTest();
  delete process.env.LARIAT_WHISPER;
});

afterEach(() => {
  _resetForTest();
  if (ORIG_FLAG === undefined) delete process.env.LARIAT_WHISPER;
  else process.env.LARIAT_WHISPER = ORIG_FLAG;
});

describe('parseWavToFloat32', () => {
  it('decodes 16 kHz mono PCM16 into normalized Float32', () => {
    const pcm = parseWavToFloat32(wavPcm16([0, 16384, -16384, 32767]));
    assert.equal(pcm.length, 4);
    assert.equal(pcm[0], 0);
    assert.ok(Math.abs(pcm[1] - 0.5) < 1e-3);
    assert.ok(Math.abs(pcm[2] + 0.5) < 1e-3);
    assert.ok(pcm[3] > 0.99);
  });

  it('rejects non-16k sample rates', () => {
    assert.throws(() => parseWavToFloat32(wavPcm16([0, 0], { rate: 44100 })), /16000 Hz/);
  });

  it('rejects stereo', () => {
    assert.throws(() => parseWavToFloat32(wavPcm16([0, 0], { channels: 2 })), /mono/);
  });

  it('rejects garbage and truncated bodies', () => {
    assert.throws(() => parseWavToFloat32(new Uint8Array(10)), /too short/);
    const junk = new Uint8Array(64).fill(7);
    assert.throws(() => parseWavToFloat32(junk), /RIFF/);
  });
});

describe('language hints', () => {
  it('maps the composer picker labels and auto-detects unknowns', () => {
    assert.equal(whisperLanguageHint('Spanish'), 'es');
    assert.equal(whisperLanguageHint('English'), 'en');
    assert.equal(whisperLanguageHint('Klingon'), undefined);
    assert.equal(whisperLanguageHint(42), undefined);
  });
});

describe('env gating', () => {
  it('isWhisperEnabled follows LARIAT_WHISPER=1 exactly', () => {
    assert.equal(isWhisperEnabled(), false);
    process.env.LARIAT_WHISPER = '1';
    assert.equal(isWhisperEnabled(), true);
    process.env.LARIAT_WHISPER = 'true';
    assert.equal(isWhisperEnabled(), false);
  });

  it('transcribe throws when disabled (route turns this into 503)', async () => {
    await assert.rejects(() => transcribe(new Float32Array(1600)), /disabled/);
  });

  it('prewarm is a no-op when disabled (no model download attempted)', async () => {
    await prewarmWhisper(); // would reject/log if it tried to load
  });
});

describe('transcribe with a mocked pipeline', () => {
  it('passes pcm + language hint through and trims the result', async () => {
    process.env.LARIAT_WHISPER = '1';
    let seen = null;
    _setPipelineForTest(async (audio, opts) => {
      seen = { len: audio.length, opts };
      return { text: '  ochenta y seis el pollo  ' };
    });
    const out = await transcribe(new Float32Array(3200), 'es');
    assert.equal(out, 'ochenta y seis el pollo');
    assert.equal(seen.len, 3200);
    assert.equal(seen.opts.language, 'es');
    assert.equal(seen.opts.task, 'transcribe');
  });
});

describe('/api/transcribe route', () => {
  it('GET reports the flag state', async () => {
    let res = await transcribeGet();
    assert.deepEqual(await res.json(), { enabled: false });
    process.env.LARIAT_WHISPER = '1';
    res = await transcribeGet();
    assert.deepEqual(await res.json(), { enabled: true });
  });

  it('POST 503s when disabled', async () => {
    const res = await transcribePost(
      new Request('http://localhost/api/transcribe', { method: 'POST', body: wavPcm16([0]) }),
    );
    assert.equal(res.status, 503);
  });

  it('POST 400s on a bad wav when enabled', async () => {
    process.env.LARIAT_WHISPER = '1';
    const res = await transcribePost(
      new Request('http://localhost/api/transcribe', {
        method: 'POST',
        body: new Uint8Array(64).fill(7),
      }),
    );
    assert.equal(res.status, 400);
  });

  it('POST returns the transcript with the language hint applied', async () => {
    process.env.LARIAT_WHISPER = '1';
    let seenOpts = null;
    _setPipelineForTest(async (_audio, opts) => {
      seenOpts = opts;
      return { text: 'fire two ribeyes' };
    });
    const res = await transcribePost(
      new Request('http://localhost/api/transcribe?language=en', {
        method: 'POST',
        body: wavPcm16(new Array(1600).fill(1000)),
      }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { transcript: 'fire two ribeyes' });
    assert.equal(seenOpts.language, 'en');
  });

  it('POST 413s on runaway captures', async () => {
    process.env.LARIAT_WHISPER = '1';
    const res = await transcribePost(
      new Request('http://localhost/api/transcribe', {
        method: 'POST',
        body: new Uint8Array(2_100_000),
      }),
    );
    assert.equal(res.status, 413);
  });
});
