// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// Line-book sheet board — ticking, writing, saving, clearing.
//
// These run against the real generated sheets rather than a fixture, so a
// parse regression in scripts/build-boh-sheets.mjs shows up here as well
// as in tests/js/test-boh-sheets.mjs.

import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import SheetBoard from '../[sheet]/SheetBoard.jsx';
import I18nProvider from '../../_components/I18nProvider.jsx';
import { getSheet, sheetStorageKey } from '../../../lib/boh/index.ts';

const SERVICE_DATE = '2026-07-26';

const grille = getSheet('sop-grille');
const prepPar = getSheet('prep-par');
const dinner = getSheet('dinner-day-plan');

beforeEach(() => {
  window.localStorage.clear();
});

describe('SheetBoard — reading the sheet', () => {
  test('shows the sheet title, service date, and first SOP step', () => {
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);

    expect(screen.getByRole('heading', { name: grille.title })).toBeInTheDocument();
    expect(screen.getByText(`Sheet for ${SERVICE_DATE}`)).toBeInTheDocument();
    expect(screen.getByText(/Ovens, grill, salamander ON/)).toBeInTheDocument();
  });

  test('says the sheet is not the food-safety record and links there', () => {
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);

    expect(screen.getByText(/Working sheet — not a log/)).toBeInTheDocument();
    expect(screen.getByText(/Saved on this phone only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Temps and logs go in Food safety/ })).toHaveAttribute(
      'href',
      '/food-safety',
    );
  });

  test('keeps the emphasis the packet put on the things that burn you', () => {
    render(<SheetBoard sheet={prepPar} serviceDate={SERVICE_DATE} />);

    // "wet added right before service, never early" is bold on paper.
    const bolded = document.querySelectorAll('.boh-note strong, .boh-callout strong');
    expect(bolded.length).toBeGreaterThan(0);
  });
});

describe('SheetBoard — ticking and writing', () => {
  test('ticking a step moves the done counter', () => {
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);

    const boxes = screen.getAllByRole('checkbox');
    expect(screen.getByText(`0 of ${boxes.length} done`)).toBeInTheDocument();

    fireEvent.click(boxes[0]);
    expect(screen.getByText(`1 of ${boxes.length} done`)).toBeInTheDocument();
  });

  test('a ticked step survives a remount', () => {
    const { unmount } = render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    unmount();

    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
  });

  test('writing a count saves it under the sheet and service date', () => {
    render(<SheetBoard sheet={prepPar} serviceDate={SERVICE_DATE} />);

    const onHand = screen.getAllByLabelText('On hand')[0];
    fireEvent.change(onHand, { target: { value: '3' } });

    const saved = JSON.parse(
      window.localStorage.getItem(sheetStorageKey('prep-par', SERVICE_DATE)),
    );
    expect(Object.values(saved.entries)).toContain('3');
  });

  test('a different service date starts clean', () => {
    const { unmount } = render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    unmount();

    render(<SheetBoard sheet={grille} serviceDate="2026-07-27" />);
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  });

  test('one sheet does not tick another', () => {
    const { unmount } = render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    unmount();

    render(<SheetBoard sheet={dinner} serviceDate={SERVICE_DATE} />);
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  });
});

describe('SheetBoard — start new sheet', () => {
  test('asks before clearing, and clears on yes', () => {
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Start new sheet' }));
    expect(screen.getByText('Clear everything on this sheet?')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, clear it' }));
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  });

  test('going back leaves the sheet alone', () => {
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Start new sheet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    expect(screen.queryByText('Clear everything on this sheet?')).not.toBeInTheDocument();
  });
});

describe('SheetBoard — copy for the handoff board', () => {
  test('copies the filled sheet as text', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.change(screen.getByPlaceholderText(/Low items, problems/), {
      target: { value: 'Salamander running cold' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy sheet' }));

    // The button confirms once the clipboard write resolves.
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);

    const text = writeText.mock.calls[0][0];
    expect(text).toContain(grille.title);
    expect(text).toContain(SERVICE_DATE);
    expect(text).toMatch(/\[x\] Ovens, grill, salamander ON/);
    expect(text).toContain('Notes\nSalamander running cold');
  });
});

describe('SheetBoard — Spanish chrome', () => {
  test('renders the buttons and warning in Spanish, sheet content verbatim', () => {
    render(
      <I18nProvider locale="es">
        <SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />
      </I18nProvider>,
    );

    expect(screen.getByRole('button', { name: 'Copiar hoja' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empezar hoja nueva' })).toBeInTheDocument();
    expect(screen.getByText(/Hoja de trabajo — no es registro/)).toBeInTheDocument();

    // Sheet body is never machine-translated — pack sizes, brine times and
    // technique stay exactly as the packet wrote them.
    expect(screen.getByText(/Ovens, grill, salamander ON/)).toBeInTheDocument();
  });
});

describe('SheetBoard — reference grids', () => {
  test('keeps the printed score denominator beside the box', () => {
    const deepClean = getSheet('deep-clean');
    render(<SheetBoard sheet={deepClean} serviceDate={SERVICE_DATE} />);

    const hints = document.querySelectorAll('.boh-hint');
    expect(hints.length).toBeGreaterThan(0);
    expect(within(hints[0]).queryByText).toBeDefined();
    expect(hints[0].textContent).toMatch(/^\/\d+$/);
  });
});
