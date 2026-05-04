// FireSchedule jsdom test (T8) — page rendering, age coloring, ack flow.
// Web Audio is mocked at the page boundary; useFireCue's tone path
// is covered by behavioral assertions on the visual pulse callback.

import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import FireSchedulePage from '../prep/fire-schedule/page';
import CourseCard from '../prep/fire-schedule/_components/CourseCard';
import { _resetFiredForTest } from '../prep/fire-schedule/_lib/useFireCue';

function mockFetch(payload) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  });
}

beforeEach(() => {
  _resetFiredForTest();
  // T12: localStorage consent persists across tests by default — clear it
  // so each test starts from "no consent" unless it sets one explicitly.
  try { window.localStorage.removeItem('lariat_fire_sound_consent'); } catch {}
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

const SAMPLE = {
  date: '2026-05-04',
  location_id: 'default',
  stations: [
    {
      station_id: 'grill',
      courses: [
        {
          id: 1,
          event_id: 42,
          event_title: 'Hendricks Wedding',
          course_label: 'Entree',
          fire_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          lines: [
            { id: 901, item_name: 'Smoked Brisket', quantity: 80, prep_notes: 'no sauce' },
          ],
        },
      ],
    },
    {
      station_id: 'sides',
      courses: [],
    },
  ],
};

describe('FireSchedulePage', () => {
  test('renders empty state when API returns no stations', async () => {
    mockFetch({ date: '2026-05-04', location_id: 'default', stations: [] });
    render(<FireSchedulePage />);
    await waitFor(() => {
      expect(screen.getByText(/no fires today/i)).toBeInTheDocument();
    });
  });

  test('renders station columns and course cards from the API', async () => {
    mockFetch(SAMPLE);
    render(<FireSchedulePage />);
    await waitFor(() => {
      expect(screen.getByTestId('station-grill')).toBeInTheDocument();
      expect(screen.getByTestId('station-sides')).toBeInTheDocument();
      expect(screen.getByText('Hendricks Wedding')).toBeInTheDocument();
      expect(screen.getByText('Entree')).toBeInTheDocument();
      expect(screen.getByText('Smoked Brisket')).toBeInTheDocument();
    });
  });

  test('shows "Turn sound on" button until clicked', async () => {
    // Provide a stub AudioContext on window so enable click works.
    // state='running' so audio is "ready" after click.
    window.AudioContext = jest.fn().mockImplementation(() => ({ state: 'running' }));
    mockFetch(SAMPLE);
    render(<FireSchedulePage />);
    await waitFor(() => screen.getByTestId('enable-sound'));
    fireEvent.click(screen.getByTestId('enable-sound'));
    await waitFor(() => {
      expect(screen.queryByTestId('enable-sound')).not.toBeInTheDocument();
    });
    // T12: consent persisted to localStorage
    expect(window.localStorage.getItem('lariat_fire_sound_consent')).toBe('1');
  });

  test('auto-creates AudioContext on mount when localStorage consent is set (T12)', async () => {
    // Pre-set consent (cook tapped "Turn sound on" yesterday).
    window.localStorage.setItem('lariat_fire_sound_consent', '1');
    // Suspended context — autoplay policy.
    const resume = jest.fn().mockResolvedValue(undefined);
    window.AudioContext = jest.fn().mockImplementation(() => ({ state: 'suspended', resume }));
    mockFetch(SAMPLE);
    render(<FireSchedulePage />);
    await waitFor(() => screen.getByText(/hendricks wedding/i));
    // Button is shown but with the "wake" copy (context is suspended)
    expect(screen.getByTestId('enable-sound')).toHaveTextContent(/wake sound/i);
    // Tap it — calls resume() and the button hides
    fireEvent.click(screen.getByTestId('enable-sound'));
    await waitFor(() => expect(resume).toHaveBeenCalled());
  });

  test('shows error message when fetch fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    render(<FireSchedulePage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});

describe('CourseCard age coloring', () => {
  function cardForFireAt(iso, now) {
    const course = {
      id: 99,
      event_id: 1,
      event_title: 'Test Event',
      course_label: 'Test',
      fire_at: iso,
      lines: [],
    };
    return render(<CourseCard course={course} audioCtx={null} now={now} />);
  }

  test('green card when fire is far in the future', () => {
    const now = new Date('2026-05-04T18:00:00.000Z');
    const fire = '2026-05-04T19:30:00.000Z'; // 90 min away
    cardForFireAt(fire, now);
    const card = screen.getByTestId('course-card-99');
    expect(card.className).toMatch(/fs-green/);
  });

  test('yellow card when fire is ≤30min away', () => {
    const now = new Date('2026-05-04T19:15:00.000Z');
    const fire = '2026-05-04T19:30:00.000Z'; // 15 min away
    cardForFireAt(fire, now);
    expect(screen.getByTestId('course-card-99').className).toMatch(/fs-yellow/);
  });

  test('red card when fire is past', () => {
    const now = new Date('2026-05-04T19:31:00.000Z');
    const fire = '2026-05-04T19:30:00.000Z';
    cardForFireAt(fire, now);
    expect(screen.getByTestId('course-card-99').className).toMatch(/fs-red/);
  });

  test('Ack button disables itself after click', () => {
    const now = new Date('2026-05-04T18:00:00.000Z');
    const fire = '2026-05-04T19:30:00.000Z';
    cardForFireAt(fire, now);
    const ack = screen.getByRole('button', { name: /ack test for test event/i });
    expect(ack).not.toBeDisabled();
    fireEvent.click(ack);
    const ack2 = screen.getByRole('button', { name: /ack test for test event/i });
    expect(ack2).toBeDisabled();
    expect(ack2).toHaveTextContent(/got it/i);
  });
});
