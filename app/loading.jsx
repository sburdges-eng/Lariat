export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page content"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '40vh',
        color: 'var(--muted)',
        fontSize: 15,
      }}
    >
      <span aria-hidden="true">Loading…</span>
      <span className="sr-only">Loading, please wait.</span>
    </div>
  );
}
