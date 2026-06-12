// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// i18n S2 — the shared client boards render Spanish chrome inside an
// es-locale provider, keep DB-sourced data verbatim, and default to
// English when no provider wraps them (the v1 routes).

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

import I18nProvider from '../_components/I18nProvider.jsx';
import EightySixBoard from '../eighty-six/EightySixBoard.jsx';

const BOARD_PROPS = {
  active: [
    {
      id: 1,
      item: 'Pork Chop',
      station_id: 'grill',
      reason: 'out',
      quantity: '',
      created_at: '2026-06-12 18:00:00',
      cook_id: 'alex',
    },
  ],
  resolved: [],
  cascaded: [],
  stations: [{ id: 'grill', name: 'Grill' }],
  date: '2026-06-12',
  locationId: 'default',
};

test('EightySixBoard renders Spanish chrome under locale="es"', () => {
  render(
    <I18nProvider locale="es">
      <EightySixBoard {...BOARD_PROPS} />
    </I18nProvider>,
  );
  expect(screen.getByRole('heading', { name: 'Tablero 86' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /de vuelta en stock/i })).toBeInTheDocument();
  // DB data renders verbatim — never translated.
  expect(screen.getByText('Pork Chop')).toBeInTheDocument();
  expect(screen.getByText('Grill')).toBeInTheDocument();
});

test('EightySixBoard defaults to English without a provider (v1 routes)', () => {
  render(<EightySixBoard {...BOARD_PROPS} />);
  expect(screen.getByRole('heading', { name: '86 Board' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: `Mark Pork Chop as back in stock` })).toBeInTheDocument();
});

test('reason display labels translate while option values stay API codes', () => {
  render(
    <I18nProvider locale="es">
      <EightySixBoard {...BOARD_PROPS} />
    </I18nProvider>,
  );
  const reasonSelect = screen.getByLabelText('Motivo');
  const options = Array.from(reasonSelect.querySelectorAll('option'));
  const prepShort = options.find((o) => o.value === 'prep_short');
  expect(prepShort).toBeTruthy();
  expect(prepShort.textContent).toBe('Falta prep');
});
