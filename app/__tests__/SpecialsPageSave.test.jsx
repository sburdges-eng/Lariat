// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SpecialsPage from '../specials/page';

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

function mockChatResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      answer: 'Sear belly. Plate over slaw.',
      model: 'lari-the-kitchen-assistant',
      location_id: 'default',
      sources: [],
      cost_breakdown: [{ item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco', cost: 10 }],
      cost_total: 10,
      latencyMs: 100,
      ...overrides,
    }),
  };
}

function mockPingResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      ollamaReachable: true,
      model: 'lari-the-kitchen-assistant',
      ...overrides,
    }),
  };
}

function renderSpecialsWithPing(overrides = {}) {
  global.fetch.mockResolvedValueOnce(mockPingResponse(overrides));
  return render(<SpecialsPage />);
}

async function runChat(prompt) {
  fireEvent.change(screen.getByPlaceholderText(/Create a high-margin/i), { target: { value: prompt } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /run it/i }));
  });
}

test('Save button is hidden before an answer renders', () => {
  renderSpecialsWithPing();
  expect(screen.queryByRole('button', { name: /save this special/i })).toBeNull();
});

test('Save button appears after a successful chat response', async () => {
  renderSpecialsWithPing();
  global.fetch.mockResolvedValueOnce(mockChatResponse());
  await runChat('Make a pork belly app');
  expect(await screen.findByRole('button', { name: /save this special/i })).toBeInTheDocument();
});

test('Save form requires a name', async () => {
  renderSpecialsWithPing();
  global.fetch.mockResolvedValueOnce(mockChatResponse());
  await runChat('Make a pork belly app');
  fireEvent.click(screen.getByRole('button', { name: /save this special/i }));
  const submit = screen.getByRole('button', { name: /^save$/i });
  expect(submit).toBeDisabled();
});

test('Save POSTs the captured session shape', async () => {
  renderSpecialsWithPing();
  global.fetch
    .mockResolvedValueOnce(mockChatResponse())
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'abc-123' }) });
  await runChat('Make a pork belly app');

  fireEvent.click(screen.getByRole('button', { name: /save this special/i }));
  fireEvent.change(screen.getByPlaceholderText(/name this special/i), { target: { value: 'Pork Belly App' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  });

  const lastCall = global.fetch.mock.calls.at(-1);
  expect(lastCall[0]).toBe('/api/specials/saved');
  const body = JSON.parse(lastCall[1].body);
  expect(body.name).toBe('Pork Belly App');
  expect(body.ai_answer).toBe('Sear belly. Plate over slaw.');
  expect(body.ai_model).toBe('lari-the-kitchen-assistant');
  expect(body.cost_breakdown).toHaveLength(1);
  expect(body.cost_total).toBe(10);
});

test('Run it is disabled with clear copy when local AI is down on load', async () => {
  renderSpecialsWithPing({ ollamaReachable: false });

  expect(await screen.findByText(/AI is down/i)).toBeInTheDocument();
  const run = screen.getByRole('button', { name: /run it/i });
  expect(run).toBeDisabled();
});

test('POST 502 fetch failed is shown as local-AI-down copy, not raw transport text', async () => {
  renderSpecialsWithPing();
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 502,
    json: async () => ({ error: 'fetch failed' }),
  });

  await runChat('Make a pork belly app');

  expect(await screen.findByText(/AI is down/i)).toBeInTheDocument();
  expect(screen.queryByText(/^fetch failed$/i)).toBeNull();
});
