import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="empty">
      <h1>Not found</h1>
      <p>That page doesn&apos;t exist.</p>
      <Link href="/" className="btn primary">Back to Today</Link>
    </div>
  );
}
