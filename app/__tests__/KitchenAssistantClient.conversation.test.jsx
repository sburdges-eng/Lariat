// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import KitchenAssistantClient from '../kitchen-assistant/KitchenAssistantClient';

const SESSION = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  window.localStorage.clear();
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

async function ask(question = 'what is 86?') {
  render(<KitchenAssistantClient locQuery="" />);
  fireEvent.change(screen.getByLabelText(/Ask a question/i), { target: { value: question } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ask kitchen assistant/i }));
  });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  const postCall = global.fetch.mock.calls.find(
    ([url, init]) => url === '/api/kitchen-assistant' && init?.method === 'POST',
  );
  expect(postCall).toBeTruthy();
  return JSON.parse(postCall[1].body);
}

test('generates and sends conversation_session_id with existing cook_id and location_id', async () => {
  window.localStorage.setItem('lariat_cook', 'cook-alex');
  window.localStorage.setItem('lariat_location', 'west');

  const body = await ask('show vendor shocks');

  expect(body.message).toBe('show vendor shocks');
  expect(body.conversation_session_id).toBe(SESSION);
  expect(body.cook_id).toBe('cook-alex');
  expect(body.location_id).toBe('west');
  expect(window.localStorage.getItem('lariat_conversation_session_id')).toBe(SESSION);
});

test('reuses existing conversation_session_id and omits missing cook_id', async () => {
  window.localStorage.setItem('lariat_conversation_session_id', SESSION);

  const body = await ask('follow up');

  expect(global.crypto.randomUUID).not.toHaveBeenCalled();
  expect(body.conversation_session_id).toBe(SESSION);
  expect(Object.prototype.hasOwnProperty.call(body, 'cook_id')).toBe(false);
});
