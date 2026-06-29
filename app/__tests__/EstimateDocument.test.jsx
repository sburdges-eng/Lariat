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
