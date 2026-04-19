'use client';
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';

const ALLERGENS = ['gluten','dairy','egg','soy','nuts','fish','shellfish','sesame'];

export default function RecipeBrowser({ recipes }) {
  const [q, setQ] = useState('');
  const [allergens, setAllergens] = useState(new Set());
  const [locQ, setLocQ] = useState('');

  useEffect(() => {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem('lariat_location') : '';
    if (v && v !== 'default') setLocQ(`?location=${encodeURIComponent(v)}`);
  }, []);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return recipes.filter(r => {
      if (allergens.size > 0 && ![...allergens].some(a => r.allergens.includes(a))) return false;
      if (!ql) return true;
      if (r.name.toLowerCase().includes(ql)) return true;
      if (r.ingredients_text.includes(ql)) return true;
      return false;
    });
  }, [q, allergens, recipes]);

  const toggleAllergen = (a) => {
    const next = new Set(allergens);
    if (next.has(a)) next.delete(a); else next.add(a);
    setAllergens(next);
  };

  return (
    <>
      <input className="recipe-search" placeholder="Search recipes or ingredients…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <div className="filters">
        <span style={{ alignSelf:'center', color:'var(--muted)', fontSize:13, marginRight:6 }}>Contains:</span>
        {ALLERGENS.map(a => (
          <span key={a} className={`chip allergen ${allergens.has(a) ? 'active' : ''}`} onClick={() => toggleAllergen(a)}>{a}</span>
        ))}
        {(q || allergens.size > 0) && (
          <span className="chip" onClick={() => { setQ(''); setAllergens(new Set()); }}>clear</span>
        )}
      </div>
      <div style={{ color:'var(--muted)', fontSize:13, marginBottom:14 }}>{filtered.length} of {recipes.length} recipes</div>
      <div className="recipe-grid">
        {filtered.map(r => (
          <Link key={r.slug} href={`/recipes/${r.slug}${locQ}`} style={{ textDecoration:'none' }}>
            <div className="recipe-card">
              <h3>{r.name}</h3>
              <div className="ingredient-count">{r.ingredient_count} ingredients</div>
              {r.allergens.length > 0 && (
                <div className="recipe-allergens">
                  {r.allergens.map(a => <span key={a} className="allergen-tag">{a}</span>)}
                </div>
              )}
            </div>
          </Link>
        ))}
        {filtered.length === 0 && <div className="empty">No recipes match.</div>}
      </div>
    </>
  );
}
