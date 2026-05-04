'use client';

import { useState } from 'react';
import { ageBucketFor } from '../../../../lib/beoFireSchedule';
import { useFireCue } from '../_lib/useFireCue';

function timeStr(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export default function CourseCard({ course, audioCtx, now }) {
  const [pulsing, setPulsing] = useState(false);
  const [acked, setAcked] = useState(false);
  const bucket = ageBucketFor(course.fire_at, now);
  const fireMs = Date.parse(course.fire_at);

  useFireCue({
    courseId: course.id,
    fireAtMs: fireMs,
    audioCtx,
    onPulse: () => {
      setPulsing(true);
      setTimeout(() => setPulsing(false), 5000);
    },
    ackFn: () => acked,
  });

  return (
    <div
      data-testid={`course-card-${course.id}`}
      className={`fs-card fs-${bucket}${pulsing ? ' fs-pulse' : ''}`}
    >
      <div className="fs-card-head">
        <span className="fs-event-title">{course.event_title}</span>
        <span className="fs-fire-time">{timeStr(course.fire_at)}</span>
      </div>
      <div className="fs-course-label">{course.course_label}</div>
      <ul className="fs-line-list">
        {course.lines.map((l) => (
          <li key={l.id} className="fs-line">
            <span className="fs-qty">{l.quantity}</span>
            <span className="fs-item">{l.item_name}</span>
            {l.prep_notes && <span className="fs-prep">— {l.prep_notes}</span>}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => setAcked(true)}
        aria-label={`Ack ${course.course_label} for ${course.event_title}`}
        disabled={acked}
      >
        {acked ? 'Got it' : 'Ack'}
      </button>
    </div>
  );
}
