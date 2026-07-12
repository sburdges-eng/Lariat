// @ts-check
'use client';

import { useEffect, useState } from 'react';

// CoursePanel — manage BEO courses for one event (T6).
//
// Per docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// Self-contained: fetches its own course list, owns the add/edit/delete
// flows, accepts a `lines` prop (the open event's beo_line_items) so
// the binding picker can list them. Mounted in BeoBoard right rail.
//
// UI copy follows docs/UI_COPY_RULES.md — kitchen verbs only.

/**
 * The subset of a BEO event (beo_events row) this panel needs.
 * @typedef {{
 *   id: number,
 *   event_date?: string | null,
 *   location_id?: string | null,
 * }} CoursePanelEvent
 */

/**
 * The subset of a BEO line item (beo_line_items row) this panel needs
 * for the bind-lines picker.
 * @typedef {{
 *   id: number,
 *   item_name: string,
 *   quantity: number,
 *   course_id?: number | null,
 * }} CoursePanelLine
 */

/**
 * A beo_courses row, as returned by GET/POST /api/beo/courses.
 * @typedef {{
 *   id: number,
 *   event_id?: number,
 *   location_id?: string,
 *   course_label: string,
 *   fire_at: string,
 *   notes?: string | null,
 *   sort_order?: number,
 *   created_at?: string,
 *   updated_at?: string,
 * }} Course
 */

const HHMM_RE = /^(\d{2}):(\d{2})$/;

/**
 * Convert "19:30" + an event_date "2026-05-04" to canonical ISO-8601 UTC.
 * @param {string} eventDate
 * @param {string} hhmm
 * @returns {string | null}
 */
function combineToIso(eventDate, hhmm) {
  if (!eventDate || !HHMM_RE.test(hhmm)) return null;
  // Build a Date in local time, then take its UTC ISO. Operators enter
  // wall-clock times; the server stores UTC.
  const d = new Date(`${eventDate}T${hhmm}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Show a fire_at ISO as local "HH:MM" for display.
 * @param {string | null | undefined} iso
 * @returns {string}
 */
function isoToLocalHHMM(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * @param {{
 *   event: CoursePanelEvent | null | undefined,
 *   lines?: CoursePanelLine[],
 *   courses?: Course[],
 *   onCoursesChanged?: () => void,
 * }} props
 */
export default function CoursePanel({ event, lines = [], courses: externalCourses, onCoursesChanged }) {
  // T11 made BeoBoard the source of truth for courses. When `externalCourses`
  // is supplied we render from it and call `onCoursesChanged` after mutations
  // so the parent refetches. When it's not, we fall back to self-fetching
  // (preserves the standalone-component behavior used by tests).
  const externallyManaged = Array.isArray(externalCourses);
  const [internalCourses, setInternalCourses] = useState(/** @type {Course[]} */ ([]));
  const courses = externallyManaged ? /** @type {Course[]} */ (externalCourses) : internalCourses;
  /** @type {(updater: Course[] | ((prev: Course[]) => Course[])) => void} */
  const setCourses = externallyManaged
    ? () => { onCoursesChanged?.(); }
    : setInternalCourses;
  const [loaded, setLoaded] = useState(externallyManaged);
  const [err, setErr] = useState('');

  // Add-form state
  const [newLabel, setNewLabel] = useState('');
  const [newTime, setNewTime] = useState('');

  // Bind-lines state, keyed by course id → Set of line ids selected
  const [openBinder, setOpenBinder] = useState(/** @type {number | null} */ (null));

  const eventId = event?.id ?? null;
  const eventDate = event?.event_date ?? '';
  const location = event?.location_id ?? 'default';

  const load = async () => {
    // When the parent owns courses, this is a no-op — parent refetches
    // through onCoursesChanged.
    if (externallyManaged) {
      onCoursesChanged?.();
      return;
    }
    if (!eventId) {
      setInternalCourses([]);
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(
        `/api/beo/courses?event_id=${encodeURIComponent(eventId)}&location=${encodeURIComponent(location)}`,
      );
      if (!res.ok) {
        setErr('Couldn’t load courses');
        setLoaded(true);
        return;
      }
      const j = await res.json();
      setInternalCourses(Array.isArray(j.courses) ? j.courses : []);
      setLoaded(true);
    } catch {
      setErr('Couldn’t load courses');
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (!externallyManaged) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, externallyManaged]);

  const addCourse = async () => {
    setErr('');
    if (!newLabel.trim()) {
      setErr('Course needs a name');
      return;
    }
    const fireAt = combineToIso(eventDate, newTime);
    if (!fireAt) {
      setErr('Pick a fire time (HH:MM)');
      return;
    }
    try {
      const res = await fetch('/api/beo/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          course_label: newLabel.trim(),
          fire_at: fireAt,
          location_id: location,
        }),
      });
      if (!res.ok) {
        setErr('Didn’t save — try again');
        return;
      }
      const created = await res.json();
      setCourses((c) => [...c, created]);
      setNewLabel('');
      setNewTime('');
    } catch {
      setErr('Lost connection — not saved');
    }
  };

  /** @param {number} id */
  const deleteCourse = async (id) => {
    setErr('');
    try {
      const res = await fetch(`/api/beo/courses/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location_id: location }),
      });
      if (!res.ok) {
        setErr('Didn’t delete — try again');
        return;
      }
      setCourses((c) => c.filter((x) => x.id !== id));
    } catch {
      setErr('Lost connection — not deleted');
    }
  };

  /**
   * @param {number} lineId
   * @param {number | null} courseId
   */
  const bindLine = async (lineId, courseId) => {
    setErr('');
    try {
      const res = await fetch('/api/beo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update_line', id: lineId, course_id: courseId, location_id: location }),
      });
      if (!res.ok) setErr('Didn’t bind — try again');
    } catch {
      setErr('Lost connection — not bound');
    }
  };

  if (!event) return null;

  return (
    <div className="beo-course-panel" data-testid="course-panel">
      <div className="beo-course-header">
        <h3>Courses</h3>
        <small>fire times for this event</small>
      </div>

      {err && (
        <div className="beo-course-err" role="alert">
          {err}
        </div>
      )}

      <ul className="beo-course-list">
        {loaded && courses.length === 0 && (
          <li className="beo-course-empty">No courses yet. Add one below.</li>
        )}
        {courses.map((c) => (
          <li key={c.id} className="beo-course-row" data-course-id={c.id}>
            <div className="beo-course-row-main">
              <span className="beo-course-label">{c.course_label}</span>
              <span className="beo-course-time">{isoToLocalHHMM(c.fire_at)}</span>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setOpenBinder(openBinder === c.id ? null : c.id)}
                aria-label={`Bind lines to ${c.course_label}`}
              >
                Bind lines
              </button>
              <button
                type="button"
                className="btn btn-small red"
                onClick={() => deleteCourse(c.id)}
                aria-label={`Delete ${c.course_label}`}
              >
                Delete
              </button>
            </div>
            {openBinder === c.id && (
              <div className="beo-course-binder">
                {lines.length === 0 ? (
                  <small>No line items on this event yet.</small>
                ) : (
                  lines.map((l) => (
                    <label key={l.id} className="beo-course-bind-row">
                      <input
                        type="checkbox"
                        defaultChecked={l.course_id === c.id}
                        onChange={(e) => bindLine(l.id, e.target.checked ? c.id : null)}
                      />
                      <span>
                        {l.item_name} × {l.quantity}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="beo-course-add">
        <input
          type="text"
          placeholder="Course name (e.g. Entree)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          aria-label="Course name"
        />
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          aria-label="Fire time"
        />
        <button type="button" className="btn" onClick={addCourse}>
          Add course
        </button>
      </div>
    </div>
  );
}
