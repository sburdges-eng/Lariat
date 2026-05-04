// useFireCue — Web Audio + visual-pulse "fire is now" hook.
//
// Per spec §B (T8). Plays a 440Hz tone for 250ms when a course's
// fire_at moment first arrives in the page's lifetime, and pulses the
// caller's visual once. Idempotent per courseId per session — backed
// by an in-memory Set so re-renders don't re-trigger.
//
// Browser autoplay policy: the audio context is created lazily on the
// first user gesture (an "Enable sound" affordance in the page) and
// passed in via `audioCtx`. If audioCtx is null we no-op the tone but
// still emit the visual pulse callback.

import { useEffect, useRef } from 'react';

const FIRED = new Set<number>();

export function _resetFiredForTest(): void {
  FIRED.clear();
}

interface UseFireCueArgs {
  courseId: number;
  fireAtMs: number;            // Date.parse(fire_at)
  audioCtx: AudioContext | null;
  onPulse?: () => void;        // visual pulse callback
  ackFn?: () => boolean;       // returns true if user has ack'd → suppress cue
  /** Override clock for tests. Production callers should leave undefined. */
  nowFn?: () => number;
}

export function useFireCue({
  courseId,
  fireAtMs,
  audioCtx,
  onPulse,
  ackFn,
  nowFn,
}: UseFireCueArgs): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (FIRED.has(courseId)) return;

    const now = (nowFn ?? Date.now)();
    const delay = fireAtMs - now;

    // Already past the fire moment by the time we mounted: suppress
    // (cooks don't want a spammed tone for every overdue course on a
    // page reload). A re-bump from the manager would be a new course
    // id with a fresh fire_at, which fires fresh.
    if (delay <= 0) {
      FIRED.add(courseId);
      firedRef.current = true;
      return;
    }

    const t = setTimeout(() => {
      if (ackFn?.()) {
        FIRED.add(courseId);
        firedRef.current = true;
        return;
      }
      try {
        if (audioCtx && typeof audioCtx.createOscillator === 'function') {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.frequency.value = 440;
          osc.type = 'sine';
          gain.gain.value = 0.2;
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.25);
        }
      } catch {
        // Audio failure is never fatal — visual pulse still happens.
      }
      onPulse?.();
      FIRED.add(courseId);
      firedRef.current = true;
    }, delay);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, fireAtMs]);
}
