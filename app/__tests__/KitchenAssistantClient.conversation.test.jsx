// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import KitchenAssistantClient from '../kitchen-assistant/KitchenAssistantClient';

const SESSION = '11111111-1111-4111-8111-111111111111';
let speechInstances = [];

class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onresult = null;
    this.start = jest.fn(() => {
      this.onstart?.();
    });
    this.stop = jest.fn(() => {
      this.onend?.();
    });
    this.abort = jest.fn();
    speechInstances.push(this);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  speechInstances = [];
  window.SpeechRecognition = MockSpeechRecognition;
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
  jest.useRealTimers();
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

// ── slice 2.7 — 30-second undo toast card ─────────────────────────

const UNDO_LABEL = "Marked salmon as 86'd.";

function undoAnswerResponse(expiresInMs = 30000) {
  return {
    ok: true,
    json: async () => ({
      answer: '⚡ ACTION EXECUTED: done.',
      model: 'lari-the-kitchen-assistant',
      location_id: 'west',
      sources: [],
      latencyMs: 12,
      actionExecuted: true,
      actionError: false,
      undo: {
        audit_event_id: 42,
        entity: 'eighty_six',
        entity_id: 7,
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
        label: UNDO_LABEL,
      },
      disclaimer: 'Check tags with a manager. Do not trust AI for allergies.',
    }),
  };
}

async function askForUndo(question = '86 the salmon') {
  render(<KitchenAssistantClient locQuery="" />);
  // Flush the mount-time ping fetch before submitting.
  await act(async () => {});
  fireEvent.change(screen.getByLabelText(/Ask a question/i), { target: { value: question } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ask kitchen assistant/i }));
  });
}

test('shows the undo card with countdown and sends the undo request when tapped', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: 'lari-the-kitchen-assistant', ollamaReachable: true }),
    })
    .mockResolvedValueOnce(undoAnswerResponse())
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, message: 'salmon is back on.', correctedAuditId: 99 }),
    });

  await askForUndo();

  // Card shows what landed, the time left, and an Undo button.
  expect(screen.getByText(UNDO_LABEL)).toBeInTheDocument();
  expect(screen.getByText(/30s to undo/i)).toBeInTheDocument();
  const undoButton = screen.getByRole('button', { name: /Undo last action/i });
  expect(undoButton).toBeInTheDocument();

  // Countdown ticks down each second.
  act(() => {
    jest.advanceTimersByTime(2000);
  });
  expect(screen.getByText(/28s to undo/i)).toBeInTheDocument();

  // Tapping Undo sends the undo request with the audit row id.
  await act(async () => {
    fireEvent.click(undoButton);
  });
  const undoCall = global.fetch.mock.calls.find(([url]) => url === '/api/kitchen-assistant/undo');
  expect(undoCall).toBeTruthy();
  expect(undoCall[1].method).toBe('POST');
  const undoBody = JSON.parse(undoCall[1].body);
  expect(undoBody.undo_audit_id).toBe(42);
  expect(undoBody.location_id).toBe('west');

  // Terse success follow-up replaces the button.
  expect(screen.getByText('salmon is back on.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Undo last action/i })).not.toBeInTheDocument();
});

test('undo card expires after 30 seconds without being tapped', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: 'lari-the-kitchen-assistant', ollamaReachable: true }),
    })
    .mockResolvedValueOnce(undoAnswerResponse());

  await askForUndo();
  expect(screen.getByRole('button', { name: /Undo last action/i })).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(30001);
  });
  expect(screen.queryByRole('button', { name: /Undo last action/i })).not.toBeInTheDocument();
  expect(screen.queryByText(UNDO_LABEL)).not.toBeInTheDocument();
});

test('undo card clears on a new question', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: 'lari-the-kitchen-assistant', ollamaReachable: true }),
    })
    .mockResolvedValueOnce(undoAnswerResponse())
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        answer: 'Nothing is 86 right now.',
        model: 'lari-the-kitchen-assistant',
        location_id: 'west',
        sources: [],
        latencyMs: 12,
      }),
    });

  await askForUndo();
  expect(screen.getByRole('button', { name: /Undo last action/i })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/Ask a question/i), { target: { value: "what's 86?" } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ask kitchen assistant/i }));
  });

  expect(screen.queryByRole('button', { name: /Undo last action/i })).not.toBeInTheDocument();
  expect(screen.queryByText(UNDO_LABEL)).not.toBeInTheDocument();
});

test('undo card shows terse error copy when the undo is rejected', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ model: 'lari-the-kitchen-assistant', ollamaReachable: true }),
    })
    .mockResolvedValueOnce(undoAnswerResponse())
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Undo time ran out.' }),
    });

  await askForUndo();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Undo last action/i }));
  });

  expect(screen.getByText('Undo time ran out.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Undo last action/i })).not.toBeInTheDocument();
});

test('starts voice input while held and stops when released', async () => {
  render(<KitchenAssistantClient locQuery="" />);

  const voiceButton = await screen.findByRole('button', { name: /start voice input/i });
  fireEvent.pointerDown(voiceButton);

  expect(speechInstances).toHaveLength(1);
  expect(speechInstances[0].start).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument());

  fireEvent.pointerUp(screen.getByRole('button', { name: /stop voice input/i }));

  expect(speechInstances[0].stop).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument());
});

test('starts voice input on keyboard press and stops on key release', async () => {
  render(<KitchenAssistantClient locQuery="" />);

  const voiceButton = await screen.findByRole('button', { name: /start voice input/i });
  fireEvent.keyDown(voiceButton, { key: ' ', code: 'Space' });

  expect(speechInstances).toHaveLength(1);
  expect(speechInstances[0].start).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument());

  fireEvent.keyUp(screen.getByRole('button', { name: /stop voice input/i }), { key: ' ', code: 'Space' });

  expect(speechInstances[0].stop).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument());
});

test('stops voice input when the hold-to-talk button loses focus', async () => {
  render(<KitchenAssistantClient locQuery="" />);

  const voiceButton = await screen.findByRole('button', { name: /start voice input/i });
  fireEvent.keyDown(voiceButton, { key: 'Enter', code: 'Enter' });

  expect(speechInstances).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument());

  fireEvent.blur(screen.getByRole('button', { name: /stop voice input/i }));

  expect(speechInstances[0].stop).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument());
});

test('stops voice input before submitting a question', async () => {
  render(<KitchenAssistantClient locQuery="" />);

  const voiceButton = await screen.findByRole('button', { name: /start voice input/i });
  fireEvent.pointerDown(voiceButton);

  expect(speechInstances).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText(/Ask a question/i), { target: { value: 'what is 86?' } });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ask kitchen assistant/i }));
  });

  expect(speechInstances[0].stop).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument());
});

test('recovers from a speech-recognition error so hold-to-talk can start again', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<KitchenAssistantClient locQuery="" />);

  const voiceButton = await screen.findByRole('button', { name: /start voice input/i });
  fireEvent.pointerDown(voiceButton);

  expect(speechInstances).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument());

  await act(async () => {
    speechInstances[0].onerror?.({ error: 'network' });
  });

  await waitFor(() => expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument());

  fireEvent.pointerDown(screen.getByRole('button', { name: /start voice input/i }));

  expect(errorSpy).toHaveBeenCalledWith('Speech error:', { error: 'network' });
  expect(speechInstances).toHaveLength(2);
  expect(speechInstances[1].start).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: /stop voice input/i })).toBeInTheDocument());
});
