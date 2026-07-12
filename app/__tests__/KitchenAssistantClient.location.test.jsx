// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
/** @jest-environment jsdom */
// Regression for a bug found during the GH #250 checkjs migration:
// KitchenAssistantClient destructured its locQuery prop as
// `{ locQuery: _locQuery }` — explicitly discarded (a lint-silencing
// rename that never got wired up, per git blame) — and instead read
// the current location only from window.localStorage. A fresh,
// bookmarked, or shared-iPad deep link like
// /kitchen-assistant?location=west was silently ignored: the assistant
// answered using whichever location was last selected on that device,
// not the location named in the URL, exposing that location's 86 list,
// inventory, and line-check state under a URL claiming a different one.
//
// Fixed by wiring in the shared useLocation() hook (already used by
// Sidebar/CommandPalette/Floorplan), which honors ?location= as an
// override over localStorage.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockSearchParams = new URLSearchParams('');

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import KitchenAssistantClient from '../kitchen-assistant/KitchenAssistantClient';

const SESSION = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  window.localStorage.clear();
  mockSearchParams = new URLSearchParams('');
  window.SpeechRecognition = undefined;
  window.webkitSpeechRecognition = undefined;
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: 'lari-the-kitchen-assistant', ollamaReachable: true }),
    })
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Answer.',
        model: 'lari-the-kitchen-assistant',
        location_id: 'west',
        sources: [],
        latencyMs: 12,
        disclaimer: 'Check tags with a manager. Do not trust AI for allergies.',
      }),
    });
  Object.defineProperty(global.crypto, 'randomUUID', {
    configurable: true,
    value: jest.fn(() => SESSION),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function ask() {
  render(<KitchenAssistantClient />);
  fireEvent.change(screen.getByLabelText(/Ask a question/i), { target: { value: 'what is 86?' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ask kitchen assistant/i }));
  });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  return global.fetch.mock.calls.find(
    ([url]) => typeof url === 'string' && url === '/api/kitchen-assistant',
  );
}

describe('KitchenAssistantClient — location scoping', () => {
  test('a stale localStorage location is overridden by ?location= in the URL', async () => {
    window.localStorage.setItem('lariat_location', 'default');
    mockSearchParams = new URLSearchParams('location=west');

    const postCall = await ask();
    const body = JSON.parse(postCall[1].body);
    expect(body.location_id).toBe('west');
  });

  test('falls back to localStorage when no ?location= is present', async () => {
    window.localStorage.setItem('lariat_location', 'uptown');
    mockSearchParams = new URLSearchParams('');

    const postCall = await ask();
    const body = JSON.parse(postCall[1].body);
    expect(body.location_id).toBe('uptown');
  });
});
