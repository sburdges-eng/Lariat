import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { computeRestartDecision, type Attempt } from '../supervisor.ts';

const NOW = 1_000_000;

test('first failure schedules restart at 1s', () => {
  const decision = computeRestartDecision([], NOW);
  assert.deepEqual(decision, { action: 'restart', delayMs: 1000 });
});

test('second failure (within 60s) schedules at 2s', () => {
  const attempts: Attempt[] = [{ tsMs: NOW - 5_000 }];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 2000 },
  );
});

test('third failure (within 60s) schedules at 5s', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 10_000 },
    { tsMs: NOW - 5_000 },
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 5000 },
  );
});

test('fourth failure within 60s gives up', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 30_000 },
    { tsMs: NOW - 20_000 },
    { tsMs: NOW - 10_000 },
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'give_up' },
  );
});

test('attempts older than 60s do not count toward give-up', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 90_000 },  // expired
    { tsMs: NOW - 80_000 },  // expired
    { tsMs: NOW - 70_000 },  // expired
    { tsMs: NOW - 5_000 },   // counts as the only recent
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 2000 },
  );
});
