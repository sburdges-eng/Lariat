// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

// EventFirePanel — per-event fire schedule read-only view (T3).
//
// Fetches GET /api/beo/fire-schedule?event_id=N&location=<loc>
// and renders stations → courses → lines with age-coloring via ageBucketFor.
// No audio cues, no editing — embedded in the BEO board Fire tab.

import { useEffect, useState } from 'react';
import { ageBucketFor } from '../../../lib/beoFireSchedule';

/** Format an ISO fire_at string to a local clock time string (e.g. "7:30 PM"). */
function formatFireTime(fireAt) {
  if (!fireAt) return '';
  try {
    return new Date(fireAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function EventFirePanel({ eventId, location = 'default' }) {
  const [state, setState] = useState('loading'); // 'loading' | 'error' | 'empty' | 'loaded'
  const [stations, setStations] = useState([]);

  useEffect(() => {
    if (eventId == null) {
      // Guard: no event selected, stay in loading without fetching
      setState('loading');
      return;
    }

    let cancelled = false;
    setState('loading');

    fetch(
      `/api/beo/fire-schedule?event_id=${encodeURIComponent(eventId)}&location=${encodeURIComponent(location)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState('error');
          return;
        }
        const j = await res.json();
        if (cancelled) return;
        const st = Array.isArray(j.stations) ? j.stations : [];
        if (st.length === 0) {
          setState('empty');
        } else {
          setStations(st);
          setState('loaded');
        }
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, location]);

  if (state === 'loading') {
    return (
      <div data-testid="event-fire-loading" className="beo-fire-loading">
        Loading…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div data-testid="event-fire-error" className="beo-fire-error">
        Couldn't load fire schedule — tap to retry.
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div data-testid="event-fire-empty" className="beo-fire-empty">
        No fire times set for this event yet.
      </div>
    );
  }

  return (
    <div className="beo-fire-panel">
      {stations.map((station) => {
        const displayName =
          station.station_id === 'unassigned' ? 'Unassigned' : station.station_id;
        return (
          <section
            key={station.station_id}
            data-testid="event-fire-station"
            className="beo-fire-station"
          >
            <h3 className="beo-fire-station-name">{displayName}</h3>
            <div className="beo-fire-courses">
              {(station.courses || []).map((course) => {
                const bucket = ageBucketFor(course.fire_at);
                return (
                  <div
                    key={course.id}
                    data-testid="event-fire-course"
                    className={`beo-fire-course beo-fire-course--${bucket}`}
                  >
                    <div className="beo-fire-course-header">
                      <span className="beo-fire-course-label">{course.course_label}</span>
                      <span className={`beo-fire-time beo-fire-time--${bucket}`}>
                        {formatFireTime(course.fire_at)}
                      </span>
                    </div>
                    <ul className="beo-fire-lines">
                      {(course.lines || []).map((line) => (
                        <li key={line.id} className="beo-fire-line">
                          <span className="beo-fire-line-name">{line.item_name}</span>
                          <span className="beo-fire-line-qty">×{line.quantity}</span>
                          {line.prep_notes && (
                            <span className="beo-fire-line-notes">{line.prep_notes}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
