import Link from 'next/link';

export default function RecipeNotFound() {
  return (
    <div style={{ padding: '2rem', maxWidth: 540 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Recipe not found</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
        That recipe doesn&apos;t exist. It may have been removed or the name changed since the last ingest.
      </p>
      <Link href="/recipes" className="btn">Browse all recipes</Link>
    </div>
  );
}
