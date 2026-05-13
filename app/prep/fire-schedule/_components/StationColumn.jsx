// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import CourseCard from './CourseCard';

export default function StationColumn({ station, audioCtx, now }) {
  return (
    <section
      data-testid={`station-${station.station_id}`}
      className="fs-station"
      aria-label={`Station ${station.station_id}`}
    >
      <header className="fs-station-head">
        <h2>{station.station_id}</h2>
      </header>
      <div className="fs-card-stack">
        {station.courses.length === 0 ? (
          <div className="fs-empty">Nothing yet.</div>
        ) : (
          station.courses.map((c) => (
            <CourseCard key={c.id} course={c} audioCtx={audioCtx} now={now} />
          ))
        )}
      </div>
    </section>
  );
}
