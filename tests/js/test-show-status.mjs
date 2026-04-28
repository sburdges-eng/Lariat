import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusColor, pipelineStage, KNOWN_STAGES } from '../../lib/showStatus.ts';

test('statusColor: literal y → green', () => {
  assert.deepEqual(statusColor('y', 'meta_ads'), { color: 'green', label: 'y' });
});

test('statusColor: literal n → red', () => {
  assert.deepEqual(statusColor('n', 'meta_ads'), { color: 'red', label: 'n' });
});

test('statusColor: dash → neutral', () => {
  assert.deepEqual(statusColor('-', 'meta_ads'), { color: 'neutral', label: '—' });
});

test('statusColor: empty → neutral', () => {
  assert.deepEqual(statusColor('', 'meta_ads'), { color: 'neutral', label: '—' });
});

test('statusColor: pending → amber', () => {
  assert.deepEqual(statusColor('pending', 'co_host_sent'), { color: 'amber', label: 'pending' });
});

test('statusColor: w → amber (waiting)', () => {
  assert.deepEqual(statusColor('w', 'newsletter'), { color: 'amber', label: 'w' });
});

test('statusColor: accepted → green', () => {
  assert.deepEqual(statusColor('accepted', 'co_host_sent'), { color: 'green', label: 'accepted' });
});

test('statusColor: detail string preserved → green-with-detail', () => {
  assert.deepEqual(statusColor('jb, bit, sk', 'listing_jambase_bit_songkick'), {
    color: 'green',
    label: 'jb, bit, sk',
  });
});

test('statusColor: numeric posts → green with count label', () => {
  assert.deepEqual(statusColor('6.0', 'posts'), { color: 'green', label: '6' });
  assert.deepEqual(statusColor('0', 'posts'), { color: 'neutral', label: '—' });
});

test('statusColor: unknown value → green (Approach 1: never red on novelty)', () => {
  assert.deepEqual(statusColor('co-host accepted', 'co_host_sent'), {
    color: 'green',
    label: 'co-host accepted',
  });
});

test('pipelineStage: every fixture row maps to its expected stage', () => {
  // Each fixture: [row, showIsPast, expected stage].
  const fixtures = [
    [{}, false, 'Inquiry'],
    [{ announce_date: 'y' }, false, 'Hold'],
    [{ announce_date: 'y', meta_ads: 'y' }, false, 'Offer Out'],
    [{ announce_date: 'y', meta_ads: 'y', fb_event: 'y', assets: 'y' }, false, 'Confirmed'],
    [{ announce_date: 'y', meta_ads: 'y', fb_event: 'y', create_dice_tickets: 'y' }, false, 'On Sale'],
    // Settled requires showIsPast=true; without it, ticketed rows stay On Sale.
    [{ create_dice_tickets: 'y', dice_email: 'tix, dos' }, true, 'Settled'],
  ];
  for (const [f, past, expected] of fixtures) {
    const stage = pipelineStage(f, past);
    assert.ok(KNOWN_STAGES.includes(stage), `${stage} not in KNOWN_STAGES`);
    assert.equal(stage, expected, `fixture ${JSON.stringify(f)} (past=${past})`);
  }
});

test('KNOWN_STAGES is exactly the six expected stages', () => {
  assert.deepEqual(KNOWN_STAGES, [
    'Inquiry',
    'Hold',
    'Offer Out',
    'Confirmed',
    'On Sale',
    'Settled',
  ]);
});
