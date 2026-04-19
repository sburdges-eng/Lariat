import Link from 'next/link';

export default function StationNotFound() {
  return (
    <div style={{ padding: '2rem', maxWidth: 540 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Station not found</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        That station doesn&apos;t exist. It may have been renamed or removed.
      </p>
      <Link href="/" className="btn">Back to Today</Link>
    </div>
  );
}
