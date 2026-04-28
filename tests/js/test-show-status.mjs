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

test('pipelineStage: exhaustive — every fixture row maps to a known stage', () => {
  const fixtures = [
    {}, // all empty → Inquiry
    { announce_date: 'y' }, // announced → Hold
    { announce_date: 'y', meta_ads: 'y' }, // marketing started → Offer Out
    { announce_date: 'y', meta_ads: 'y', fb_event: 'y', assets: 'y' }, // → Confirmed
    { announce_date: 'y', meta_ads: 'y', fb_event: 'y', create_dice_tickets: 'y' }, // → On Sale
    { create_dice_tickets: 'y', dice_email: 'tix, dos' }, // → Settled
  ];
  for (const f of fixtures) {
    const stage = pipelineStage(f);
    assert.ok(KNOWN_STAGES.includes(stage), `${stage} not in KNOWN_STAGES`);
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
