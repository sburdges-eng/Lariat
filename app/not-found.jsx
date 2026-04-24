import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="empty" role="region" aria-labelledby="nf-h">
      <h1 id="nf-h">Not found</h1>
      <p>That page doesn&apos;t exist.</p>
      <Link href="/" className="btn primary" aria-label="Go back to Today's board">Back to Today</Link>
    </div>
  );
}
