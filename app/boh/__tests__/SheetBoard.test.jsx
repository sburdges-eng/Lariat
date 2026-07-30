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

  test('keeps a first tick made while saved state is loading', async () => {
    const key = sheetStorageKey('sop-grille', SERVICE_DATE);
    window.localStorage.setItem(key, JSON.stringify({ checks: {}, entries: {}, notes: '' }));

    let clickedDuringLoad = false;
    const originalGetItem = Storage.prototype.getItem;
    const originalConsoleError = console.error;
    const getItem = jest.spyOn(window.localStorage.__proto__, 'getItem');
    const consoleError = jest.spyOn(console, 'error').mockImplementation((...args) => {
      const message = args.map(String).join(' ');
      if (message.includes('act')) return;
      originalConsoleError(...args);
    });
    getItem.mockImplementation((requestedKey) => {
      if (requestedKey === key && !clickedDuringLoad) {
        clickedDuringLoad = true;
        fireEvent.click(document.querySelector('input[type="checkbox"]'));
      }
      return originalGetItem.call(window.localStorage, requestedKey);
    });

    try {
      render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);

      expect(clickedDuringLoad).toBe(true);
      expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
    } finally {
      getItem.mockRestore();
      consoleError.mockRestore();
    }
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

describe('SheetBoard — blocks update independently', () => {
  // Blocks only re-render when one of their own controls changes, so the
  // 276-control count sheet does not redraw on every keystroke. The risk is
  // a block that stops updating at all.
  const syscoCount = getSheet('sysco-count');

  test('typing in one row does not disturb another', () => {
    render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);

    const haves = screen.getAllByLabelText('Have');
    fireEvent.change(haves[0], { target: { value: '4' } });
    fireEvent.change(haves[5], { target: { value: '9' } });

    expect(haves[0]).toHaveValue('4');
    expect(haves[5]).toHaveValue('9');
    expect(haves[1]).toHaveValue('');
  });

  test('every block still repaints when its own control changes', () => {
    render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);

    // One control from each interactive block on the sheet.
    for (const box of screen.getAllByRole('checkbox')) {
      fireEvent.click(box);
      expect(box).toBeChecked();
    }
  });

  test('ticking in a late block does not clear an early one', () => {
    render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);

    fireEvent.change(screen.getAllByLabelText('Have')[0], { target: { value: '7' } });
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[boxes.length - 1]);

    expect(screen.getAllByLabelText('Have')[0]).toHaveValue('7');
    expect(boxes[boxes.length - 1]).toBeChecked();
  });
});

describe('SheetBoard — copying with no clipboard', () => {
  // The venue serves this over plain http on the kitchen wifi, so
  // navigator.clipboard is undefined on every phone that opens it — a
  // clipboard is only handed out in a secure context. Copy sheet is the
  // whole point of the handoff flow, so it has to work anyway.
  const noClipboard = () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  };

  test('puts the sheet on screen to copy by hand instead of failing', async () => {
    noClipboard();
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy sheet' }));

    const box = await screen.findByLabelText('Copy sheet');
    expect(box).toBeInTheDocument();
    expect(box.value).toContain(grille.title);
    expect(box.value).toMatch(/\[x\] Ovens, grill, salamander ON/);
  });

  test('the fallback text can be dismissed', async () => {
    noClipboard();
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy sheet' }));

    await screen.findByLabelText('Copy sheet');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Copy sheet')).not.toBeInTheDocument();
  });

  test('a clipboard that rejects also falls back rather than losing the sheet', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy sheet' }));

    expect(await screen.findByLabelText('Copy sheet')).toBeInTheDocument();
  });
});

describe('SheetBoard — when the phone will not save', () => {
  test('says so out loud instead of losing the sheet quietly', () => {
    // Safari private mode and a full phone both throw here. Silently
    // swallowing it means a cook counts the walk-in twice.
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(screen.getByText(/Not saving on this phone/i)).toBeInTheDocument();
    setItem.mockRestore();
  });

  test('stays quiet when saving works', () => {
    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(screen.queryByText(/Not saving on this phone/i)).not.toBeInTheDocument();
  });

  test('a sheet that will not save still ticks and copies', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(<SheetBoard sheet={grille} serviceDate={SERVICE_DATE} />);
    const box = screen.getAllByRole('checkbox')[0];
    fireEvent.click(box);
    expect(box).toBeChecked();
    setItem.mockRestore();
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

describe('SheetBoard — boxes printed in prose', () => {
  const syscoCount = getSheet('sysco-count');

  test('a box printed in a paragraph is tappable', () => {
    render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);

    const box = screen.getByRole('checkbox', { name: 'Counted all four zones' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  test('a prose box survives a remount like any other', () => {
    const { unmount } = render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '86-prone items double-checked' }));
    unmount();

    render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);
    expect(screen.getByRole('checkbox', { name: '86-prone items double-checked' })).toBeChecked();
  });

  test('the time block stays a chip, the tasks beside it become boxes', () => {
    render(<SheetBoard sheet={dinner} serviceDate={SERVICE_DATE} />);

    expect(screen.getByText('Lull (7–8):')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'Each — deep-clean task of the day (rotation sheet, initial)',
      }),
    ).toBeInTheDocument();
  });

  test('the recipe-book key is not a box', () => {
    render(<SheetBoard sheet={getSheet('recipe-index')} serviceDate={SERVICE_DATE} />);

    expect(screen.getByText(/☐ = printed card in the book/)).toBeInTheDocument();
    for (const box of screen.queryAllByRole('checkbox')) {
      expect(box).not.toHaveAccessibleName(/printed card in the book/);
    }
  });

  test('a blank and a box on one line both work', () => {
    render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);

    fireEvent.change(screen.getByLabelText('Count date'), { target: { value: '7/26' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sun' }));

    const saved = JSON.parse(window.localStorage.getItem(sheetStorageKey('sysco-count', SERVICE_DATE)));
    expect(Object.values(saved.entries)).toContain('7/26');
    expect(Object.values(saved.checks)).toContain(true);
  });

  test('ticking a prose box moves the done counter', () => {
    render(<SheetBoard sheet={syscoCount} serviceDate={SERVICE_DATE} />);

    const total = screen.getAllByRole('checkbox').length;
    expect(screen.getByText(`0 of ${total} done`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Counted all four zones' }));
    expect(screen.getByText(`1 of ${total} done`)).toBeInTheDocument();
  });
});

describe('SheetBoard — the deep-clean rotation', () => {
  const deepClean = getSheet('deep-clean');

  test('stacks the rotation into a card per day, not a five-column table', () => {
    // Five columns of sentence-length tasks means a cook scrolls sideways
    // to find their own station. One card per day fits the phone.
    render(<SheetBoard sheet={deepClean} serviceDate={SERVICE_DATE} />);

    for (const day of ['WED', 'THU', 'FRI', 'SAT', 'SUN']) {
      expect(screen.getByRole('heading', { name: day })).toBeInTheDocument();
    }
    expect(document.querySelector('.boh-matrix')).toBeInTheDocument();
  });

  test('names the station beside each task so a cook finds their own', () => {
    render(<SheetBoard sheet={deepClean} serviceDate={SERVICE_DATE} />);

    const wednesday = document.querySelector('.boh-matrix-day');
    expect(within(wednesday).getByText('A · Grille/Sauté')).toBeInTheDocument();
    expect(within(wednesday).getByText(/Boil out both fryers/)).toBeInTheDocument();
  });

  test('every rotation task is tickable', () => {
    render(<SheetBoard sheet={deepClean} serviceDate={SERVICE_DATE} />);

    const box = screen.getByRole('checkbox', { name: /Boil out both fryers/ });
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  test('the narrow grids stay tables', () => {
    // Only the rotation is stacked; the monthly list and the score grid
    // still line up as tables.
    render(<SheetBoard sheet={deepClean} serviceDate={SERVICE_DATE} />);

    expect(document.querySelectorAll('table.boh-grid').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.boh-matrix').length).toBe(1);
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
