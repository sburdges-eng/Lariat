'use client';

export default function GlobalError({ error, reset }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-labelledby="err-h"
      style={{
        padding: '2rem',
        maxWidth: 540,
        margin: '4rem auto',
        textAlign: 'center',
      }}
    >
      <h1 id="err-h" style={{ fontSize: 28, marginBottom: 8 }}>Something's wrong</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        Reload the page. If it keeps happening, tell the KM.
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => reset()}
        aria-label="Try loading this page again"
        style={{ fontSize: 16, padding: '10px 24px' }}
      >
        Try again
      </button>
    </div>
  );
}
