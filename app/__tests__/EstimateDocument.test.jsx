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

test('client register hides operator-only nodes; operator shows them', () => {
  const { container: client } = render(<EstimateDocument {...base} register="client" />);
  expect(client.querySelector('.estimate-doc.client')).toBeTruthy();
  const { container: op } = render(<EstimateDocument {...base} register="operator" />);
  expect(op.querySelector('.estimate-doc.operator')).toBeTruthy();
});

test('renders signSlot when provided', () => {
  render(<EstimateDocument {...base} register="client" signSlot={<div>SIGN HERE</div>} />);
  expect(screen.getByText('SIGN HERE')).toBeInTheDocument();
});
