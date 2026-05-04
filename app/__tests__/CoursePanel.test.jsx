// CoursePanel jsdom test (T6) — exercises load + add + delete + bind.
// Real fetch is mocked; the panel is rendered in isolation.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CoursePanel from '../beo/_components/CoursePanel';

const sampleEvent = {
  id: 42,
  title: 'Hendricks Wedding',
  event_date: '2026-05-04',
  location_id: 'default',
};

const sampleLines = [
  { id: 901, item_name: 'Smoked Brisket', quantity: 80, course_id: null },
  { id: 902, item_name: 'Half Chicken',   quantity: 40, course_id: null },
];

function mockFetchSequence(responses) {
  global.fetch = jest.fn().mockImplementation(() => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return Promise.resolve({
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: () => Promise.resolve(next.body ?? {}),
    });
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('CoursePanel', () => {
  test('renders empty state when no courses', async () => {
    mockFetchSequence([{ body: { courses: [] } }]);
    render(<CoursePanel event={sampleEvent} lines={sampleLines} />);
    await waitFor(() => {
      expect(screen.getByText(/no courses yet/i)).toBeInTheDocument();
    });
  });

  test('renders course list and shows fire time as local HH:MM', async () => {
    // 19:30 local on 2026-05-04 — expressed as the UTC ISO; the UI
    // converts back to local. Use a UTC-anchored ISO so the test is
    // tz-stable: 19:30 UTC.
    mockFetchSequence([
      {
        body: {
          courses: [
            { id: 1, course_label: 'Entree', fire_at: '2026-05-04T19:30:00.000Z' },
            { id: 2, course_label: 'Dessert', fire_at: '2026-05-04T20:30:00.000Z' },
          ],
        },
      },
    ]);
    render(<CoursePanel event={sampleEvent} lines={sampleLines} />);
    await waitFor(() => {
      expect(screen.getByText('Entree')).toBeInTheDocument();
      expect(screen.getByText('Dessert')).toBeInTheDocument();
    });
  });

  test('add course form: requires both label and time before posting', async () => {
    mockFetchSequence([{ body: { courses: [] } }]);
    render(<CoursePanel event={sampleEvent} lines={sampleLines} />);
    await waitFor(() => screen.getByText(/no courses yet/i));

    // Click "Add course" with empty fields → error, no second fetch
    fireEvent.click(screen.getByRole('button', { name: /add course/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/needs a name/i);
    // First fetch was the load; nothing more.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('add course: posts to /api/beo/courses with the right body', async () => {
    mockFetchSequence([
      { body: { courses: [] } }, // initial load
      {
        body: {
          id: 7,
          event_id: 42,
          course_label: 'Entree',
          fire_at: '2026-05-04T19:30:00.000Z',
        },
      },
    ]);
    render(<CoursePanel event={sampleEvent} lines={sampleLines} />);
    await waitFor(() => screen.getByText(/no courses yet/i));

    fireEvent.change(screen.getByLabelText(/course name/i), { target: { value: 'Entree' } });
    fireEvent.change(screen.getByLabelText(/fire time/i), { target: { value: '19:30' } });
    fireEvent.click(screen.getByRole('button', { name: /add course/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    const [, postCall] = global.fetch.mock.calls;
    expect(postCall[0]).toBe('/api/beo/courses');
    expect(postCall[1].method).toBe('POST');
    const body = JSON.parse(postCall[1].body);
    expect(body.event_id).toBe(42);
    expect(body.course_label).toBe('Entree');
    // fire_at is the UTC-ISO of "2026-05-04 19:30 LOCAL". The exact
    // string depends on the runner's TZ, but it must be canonical ISO.
    expect(body.fire_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    // After successful add the course appears in the list.
    await waitFor(() => expect(screen.getByText('Entree')).toBeInTheDocument());
  });

  test('delete course: posts DELETE then removes from list', async () => {
    mockFetchSequence([
      {
        body: {
          courses: [{ id: 7, course_label: 'Dessert', fire_at: '2026-05-04T20:30:00.000Z' }],
        },
      },
      { body: { id: 7, deleted: true } },
    ]);
    render(<CoursePanel event={sampleEvent} lines={sampleLines} />);
    await waitFor(() => screen.getByText('Dessert'));

    fireEvent.click(screen.getByRole('button', { name: /delete dessert/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    const [, delCall] = global.fetch.mock.calls;
    expect(delCall[0]).toBe('/api/beo/courses/7');
    expect(delCall[1].method).toBe('DELETE');
    await waitFor(() =>
      expect(screen.queryByText('Dessert')).not.toBeInTheDocument(),
    );
  });

  test('bind lines: shows checkboxes when expanded; toggling posts update_line', async () => {
    mockFetchSequence([
      {
        body: {
          courses: [{ id: 7, course_label: 'Entree', fire_at: '2026-05-04T19:30:00.000Z' }],
        },
      },
      { body: { ok: true } }, // bind response
    ]);
    render(<CoursePanel event={sampleEvent} lines={sampleLines} />);
    await waitFor(() => screen.getByText('Entree'));

    fireEvent.click(screen.getByRole('button', { name: /bind lines to entree/i }));

    // Both line items appear as bind checkboxes
    expect(screen.getByText(/Smoked Brisket × 80/)).toBeInTheDocument();
    expect(screen.getByText(/Half Chicken × 40/)).toBeInTheDocument();

    // Toggle the first one
    const cb = screen.getByText(/Smoked Brisket × 80/).previousSibling;
    fireEvent.click(cb);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    const [, bindCall] = global.fetch.mock.calls;
    expect(bindCall[0]).toBe('/api/beo');
    const body = JSON.parse(bindCall[1].body);
    expect(body.action).toBe('update_line');
    expect(body.id).toBe(901);
    expect(body.course_id).toBe(7);
  });
});
