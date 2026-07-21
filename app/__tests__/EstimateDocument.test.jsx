// @ts-nocheck - pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import EstimateDocument from '../beo/_components/EstimateDocument';

const base = {
  event: { id: 1, title: 'Harvest Dinner', guest_count: 60, tax_rate: 0.0815, service_fee_pct: 20 },
  sections: [{ label: 'Passed', items: [{ id: 1, item_name: 'Pig Wings', unit_cost: 4, quantity: 60 }] }],
  totals: { subtotal: 240, serviceFee: 48, tax: 19.56, total: 307.56 },
  courses: [], signatures: [],
};

test('renders title, section band label, and the estimated total', () => {
  render(<EstimateDocument {...base} register="client" />);
  expect(screen.getByText('Harvest Dinner')).toBeInTheDocument();
  expect(screen.getByText('Passed')).toBeInTheDocument();
  expect(screen.getByText('$307.56')).toBeInTheDocument();
});

// Operator-only node *hiding* is CSS-based: .estimate-doc.client [data-print="false"] { display: none }
// and @media print { .estimate-doc [data-print="false"] { display: none !important } }.
// This test verifies the root class wiring that makes those CSS rules fire, and confirms
// courses/signatures blocks are present only when the props are non-empty.
test('client register hides operator-only nodes; operator shows them', () => {
  const { container: client } = render(<EstimateDocument {...base} register="client" />);
  expect(client.querySelector('.estimate-doc.client')).toBeTruthy();
  const { container: op } = render(<EstimateDocument {...base} register="operator" />);
  expect(op.querySelector('.estimate-doc.operator')).toBeTruthy();

  // With empty courses/signatures, schedule and signed-by sections are absent
  expect(client.querySelector('.ed-schedule')).toBeNull();
  expect(client.querySelector('.ed-signed-by')).toBeNull();
});

test('renders signSlot when provided', () => {
  render(<EstimateDocument {...base} register="client" signSlot={<div>SIGN HERE</div>} />);
  expect(screen.getByText('SIGN HERE')).toBeInTheDocument();
});

test('renders contact_name as Host in Prepared For section', () => {
  const eventWithContact = { ...base.event, contact_name: 'Jane Smith' };
  render(<EstimateDocument {...base} event={eventWithContact} register="client" />);
  expect(screen.getByText('Host')).toBeInTheDocument();
  expect(screen.getByText('Jane Smith')).toBeInTheDocument();
});

test('renders Schedule block with course labels when courses prop is non-empty', () => {
  const courses = [
    { id: 1, course_label: 'Cocktail Hour', fire_at: '6:00 PM', notes: 'Poolside' },
    { id: 2, course_label: 'Dinner Service', fire_at: '7:30 PM', notes: null },
  ];
  const { container } = render(<EstimateDocument {...base} courses={courses} register="client" />);
  expect(container.querySelector('.ed-schedule')).toBeTruthy();
  expect(screen.getByText('Cocktail Hour')).toBeInTheDocument();
  expect(screen.getByText('Dinner Service')).toBeInTheDocument();
  expect(screen.getByText('Poolside', { exact: false })).toBeInTheDocument();
});

test('renders Signed-by list with signer names when signatures prop is non-empty', () => {
  const signatures = [
    { id: 1, signed_name: 'John Doe', signed_at: '2025-05-01T20:00:00Z' },
    { id: 2, signed_name: 'Jane Smith', signed_at: '2025-05-01T20:05:00Z' },
  ];
  const { container } = render(<EstimateDocument {...base} signatures={signatures} register="client" />);
  expect(container.querySelector('.ed-signed-by')).toBeTruthy();
  expect(screen.getByText('John Doe')).toBeInTheDocument();
  expect(screen.getByText('Jane Smith')).toBeInTheDocument();
});

test('omits Schedule block when courses is empty', () => {
  const { container } = render(<EstimateDocument {...base} courses={[]} register="client" />);
  expect(container.querySelector('.ed-schedule')).toBeNull();
});

test('omits Signed-by list when signatures is empty', () => {
  const { container } = render(<EstimateDocument {...base} signatures={[]} register="client" />);
  expect(container.querySelector('.ed-signed-by')).toBeNull();
});

test('formats event_date as long locale date and event_time as 12-hour', () => {
  const eventWithDateTime = { ...base.event, event_date: '2025-05-01', event_time: '20:00' };
  render(<EstimateDocument {...base} event={eventWithDateTime} register="client" />);
  expect(screen.getByText('Thursday, May 1, 2025')).toBeInTheDocument();
  expect(screen.getByText('8:00 PM')).toBeInTheDocument();
});

test('formats course fire_at ISO-8601 as 12-hour time, not raw ISO', () => {
  const courses = [
    { id: 1, course_label: 'Dinner', fire_at: '2025-05-01T20:00:00Z', notes: null },
  ];
  const { container } = render(<EstimateDocument {...base} courses={courses} register="client" />);
  // The raw ISO string must NOT appear in the schedule time cell
  expect(container.querySelector('.ed-schedule-time').textContent).not.toBe('2025-05-01T20:00:00Z');
  // The formatted time must appear (exact value depends on locale/TZ but must be non-empty)
  expect(container.querySelector('.ed-schedule-time').textContent.trim()).not.toBe('');
});

// ── Increment 2: operator food-cost overlay + F&B-minimum meter ──────────────
const foodCosts = {
  perLine: [{ id: 1, cost: 1.2, link_state: 'fully_linked', food_cost_pct: 0.3 }],
  blended: { pct: 0.3, costedCount: 1, unlinkedCount: 0 },
};

test('operator: renders per-line food-cost chip, blended line, and min-spend meter', () => {
  const { container } = render(
    <EstimateDocument {...base} register="operator" foodCosts={foodCosts} minSpend={500} />,
  );
  const chip = container.querySelector('.ed-food-chip');
  expect(chip).toBeTruthy();
  expect(chip.textContent).toMatch(/food\s*30%/i);
  expect(chip.getAttribute('data-print')).toBe('false');

  const blended = container.querySelector('.ed-food-blended');
  expect(blended).toBeTruthy();
  expect(blended.textContent).toMatch(/30%/);
  expect(blended.textContent).toMatch(/1 linked/);
  expect(blended.getAttribute('data-print')).toBe('false');

  // subtotal 240 < minSpend 500 -> under by $260.00
  const meter = container.querySelector('.ed-min-meter');
  expect(meter).toBeTruthy();
  expect(meter.classList.contains('under')).toBe(true);
  expect(meter.textContent).toMatch(/under by \$260\.00/);
  expect(meter.getAttribute('data-print')).toBe('false');
});

test('client: food-cost chips, blended line, and meter are absent from the DOM (invariant 1)', () => {
  const { container } = render(
    <EstimateDocument {...base} register="client" foodCosts={foodCosts} minSpend={500} />,
  );
  expect(container.querySelector('.ed-food-chip')).toBeNull();
  expect(container.querySelector('.ed-food-blended')).toBeNull();
  expect(container.querySelector('.ed-min-meter')).toBeNull();
});

test('operator: unlinked line shows "not linked"; meter reads met/over when subtotal >= min', () => {
  const fc = {
    perLine: [{ id: 1, cost: null, link_state: 'unlinked', food_cost_pct: null }],
    blended: { pct: null, costedCount: 0, unlinkedCount: 1 },
  };
  const { container } = render(
    <EstimateDocument {...base} register="operator" foodCosts={fc} minSpend={100} />,
  );
  expect(container.querySelector('.ed-food-chip').textContent).toMatch(/not linked/i);
  // subtotal 240 >= 100 -> met, over by $140.00
  const meter = container.querySelector('.ed-min-meter');
  expect(meter.classList.contains('met')).toBe(true);
  expect(meter.textContent).toMatch(/over by \$140\.00/);
});

test('operator: meter omitted when minSpend null; food overlay omitted when foodCosts absent', () => {
  const { container: noMeter } = render(
    <EstimateDocument {...base} register="operator" foodCosts={foodCosts} minSpend={null} />,
  );
  expect(noMeter.querySelector('.ed-min-meter')).toBeNull();
  expect(noMeter.querySelector('.ed-food-chip')).toBeTruthy();

  const { container: noFood } = render(
    <EstimateDocument {...base} register="operator" minSpend={500} />,
  );
  expect(noFood.querySelector('.ed-food-chip')).toBeNull();
  expect(noFood.querySelector('.ed-food-blended')).toBeNull();
  expect(noFood.querySelector('.ed-min-meter')).toBeTruthy();
});

test('totals (subtotal/total) are unchanged by the overlay (invariant 3)', () => {
  const { container } = render(
    <EstimateDocument {...base} register="operator" foodCosts={foodCosts} minSpend={500} />,
  );
  expect(screen.getByText('$307.56')).toBeInTheDocument(); // grand total (unique)
  // subtotal cell specifically ($240.00 also appears as the single line's extended total)
  expect(container.querySelector('.ed-sub .ed-tval').textContent).toBe('$240.00');
});

test('operator: underwater line + blended margin get the --under warning class (raw numbers kept)', () => {
  const fc = {
    perLine: [
      { id: 1, cost: 5.2, link_state: 'fully_linked', food_cost_pct: 1.3 },  // 130% -> -30% margin
      { id: 2, cost: 1.1, link_state: 'fully_linked', food_cost_pct: 0.28 }, // healthy
    ],
    blended: { pct: 1.1, costedCount: 2, unlinkedCount: 0 }, // underwater blended
  };
  const sections = [
    { label: 'Passed', items: [
      { id: 1, item_name: 'Loss Leader', unit_cost: 4, quantity: 60 },
      { id: 2, item_name: 'Healthy Item', unit_cost: 4, quantity: 60 },
    ] },
  ];
  const { container } = render(
    <EstimateDocument {...base} sections={sections} register="operator" foodCosts={fc} />,
  );
  const chips = [...container.querySelectorAll('.ed-food-chip')];
  const underChip = chips.find((c) => /130%/.test(c.textContent));
  const healthyChip = chips.find((c) => /28%/.test(c.textContent));
  // raw numbers preserved
  expect(underChip.textContent).toMatch(/food\s*130%/i);
  expect(healthyChip.textContent).toMatch(/food\s*28%/i);
  // only the underwater line carries the warning class
  expect(underChip.classList.contains('ed-food-chip--under')).toBe(true);
  expect(healthyChip.classList.contains('ed-food-chip--under')).toBe(false);
  // blended underwater row is flagged; raw negative margin kept
  const blended = container.querySelector('.ed-food-blended');
  expect(blended.classList.contains('ed-food-blended--under')).toBe(true);
  expect(blended.textContent).toMatch(/margin ≤-10%/);
});

test('renders Notes section when event.notes is present, omits it when absent', () => {
  const eventWithNotes = { ...base.event, notes: 'Please arrange flowers on tables.' };
  const { container: withNotes } = render(
    <EstimateDocument {...base} event={eventWithNotes} register="client" />
  );
  expect(withNotes.querySelector('.ed-notes')).toBeTruthy();
  expect(screen.getByText('Please arrange flowers on tables.')).toBeInTheDocument();

  const { container: withoutNotes } = render(
    <EstimateDocument {...base} event={base.event} register="client" />
  );
  expect(withoutNotes.querySelector('.ed-notes')).toBeNull();
});

// ── Event-model wave: Additional Charges (AV/fees/bar) + F&B-minimum-excludes-AV ──

test('renders Additional Charges section with each charge row and a Bar row when barRevenue > 0', () => {
  const charges = [
    { id: 1, item_name: 'PA + two wireless mics', charge: 250 },
    { id: 2, item_name: 'Room fee', charge: 300 },
  ];
  const totals = { ...base.totals, barRevenue: 400 };
  const { container } = render(
    <EstimateDocument {...base} totals={totals} charges={charges} register="client" />,
  );
  const section = container.querySelector('[aria-label="Additional charges"]');
  expect(section).toBeTruthy();
  expect(screen.getByText('PA + two wireless mics')).toBeInTheDocument();
  expect(screen.getByText('Room fee')).toBeInTheDocument();
  expect(screen.getByText('Bar')).toBeInTheDocument();
  const rows = [...section.querySelectorAll('.ed-row')];
  expect(rows).toHaveLength(3);
  expect(rows[0].querySelector('.ed-r-ext').textContent).toBe('$250.00');
  expect(rows[1].querySelector('.ed-r-ext').textContent).toBe('$300.00');
  expect(rows[2].querySelector('.ed-r-ext').textContent).toBe('$400.00');
});

test('omits Additional Charges section entirely when no charges and no bar revenue (unchanged from before this wave)', () => {
  const { container } = render(<EstimateDocument {...base} register="client" />);
  expect(container.querySelector('[aria-label="Additional charges"]')).toBeNull();
});

test('never renders a cost/margin figure for a charge -- only item_name and charge reach the DOM', () => {
  // A caller that accidentally passed `cost` through (it must never, per the
  // guest-share query, which doesn't select it) should still not leak it --
  // the component only ever reads item_name/charge off each row.
  const charges = [{ id: 1, item_name: 'Photo booth', charge: 500, cost: 90 }];
  render(<EstimateDocument {...base} charges={charges} register="client" />);
  expect(screen.queryByText('$90.00')).toBeNull();
  expect(screen.getByText('$500.00')).toBeInTheDocument();
});

test('F&B minimum meter reads fbSubtotal, not the grand subtotal that includes AV/fees', () => {
  // food-only subtotal is 240 (base fixture); an AV charge inflates the grand
  // subtotal to 740, but fbSubtotal (food + bar, no AV) stays 240 -- the
  // meter must use fbSubtotal so an AV rental can't fake "minimum met".
  const totals = { ...base.totals, subtotal: 740, fbSubtotal: 240 };
  const charges = [{ id: 1, item_name: 'AV Package', charge: 500 }];
  const { container } = render(
    <EstimateDocument {...base} totals={totals} charges={charges} register="operator" minSpend={500} />,
  );
  const meter = container.querySelector('.ed-min-meter');
  expect(meter.classList.contains('under')).toBe(true);
  expect(meter.textContent).toMatch(/under by \$260\.00/); // 500 - 240, NOT 500 - 740
});
