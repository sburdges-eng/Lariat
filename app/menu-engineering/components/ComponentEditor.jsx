'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const COMMON_UNITS = ['oz', 'g', 'lb', 'tsp', 'tbsp', 'cup', 'fl oz', 'qt', 'gal', 'each'];

export default function ComponentEditor({
  locationId,
  initialComponents,
  recipes,
  unlinkedDishes,
  declaredOnlyDishes,
}) {
  const router = useRouter();
  const [components, setComponents] = useState(initialComponents || []);
  const [dishName, setDishName] = useState('');
  const [recipeSlug, setRecipeSlug] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('oz');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const inFlightRef = useRef(false);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const c of components) {
      if (!map.has(c.dish_name)) map.set(c.dish_name, []);
      map.get(c.dish_name).push(c);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [components]);

  const candidateDishes = useMemo(() => {
    // Combine unlinked + declared-only dishes, dedupe.
    const set = new Set();
    for (const d of unlinkedDishes || []) set.add(d);
    for (const d of declaredOnlyDishes || []) set.add(d);
    return [...set].sort();
  }, [unlinkedDishes, declaredOnlyDishes]);

  const save = async (e) => {
    e?.preventDefault?.();
    if (inFlightRef.current) return;
    if (!dishName.trim() || !recipeSlug || !qty || !unit.trim()) {
      setErr('All fields except notes are required.');
      return;
    }
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setErr('qty must be a positive number');
      return;
    }
    inFlightRef.current = true;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/dish-components', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          dish_name: dishName.trim(),
          recipe_slug: recipeSlug,
          qty_per_serving: qtyNum,
          unit: unit.trim(),
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      const j = await res.json();
      const saved = j.component;
      // Upsert into local state
      setComponents((curr) => {
        const idx = curr.findIndex(
          (c) => c.dish_name === saved.dish_name && c.recipe_slug === saved.recipe_slug,
        );
        if (idx >= 0) {
          const copy = curr.slice();
          copy[idx] = saved;
          return copy;
        }
        return [...curr, saved];
      });
      setQty('');
      setNotes('');
      router.refresh();
    } catch {
      setErr('Network error — retry');
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this component?')) return;
    try {
      const res = await fetch('/api/dish-components', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || `Delete failed (HTTP ${res.status})`);
        return;
      }
      setComponents((curr) => curr.filter((c) => c.id !== id));
      router.refresh();
    } catch {
      setErr('Network error — retry');
    }
  };

  return (
    <div>
      <div className="card mb-20">
        <h3 style={{ marginTop: 0 }}>Add / update component</h3>
        <form onSubmit={save} style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr 100px 100px 1fr auto' }}>
          <div>
            <label className="meta">Dish name</label>
            <input
              type="text"
              className="input"
              value={dishName}
              onChange={(e) => setDishName(e.target.value)}
              list="dish-suggestions"
              placeholder="e.g. ROPE BURGER"
            />
            <datalist id="dish-suggestions">
              {candidateDishes.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="meta">Recipe</label>
            <select
              className="input"
              value={recipeSlug}
              onChange={(e) => setRecipeSlug(e.target.value)}
            >
              <option value="">— choose —</option>
              {recipes.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="meta">Qty / serving</label>
            <input
              type="number"
              step="0.001"
              min="0"
              className="input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div>
            <label className="meta">Unit</label>
            <input
              type="text"
              className="input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              list="unit-suggestions"
            />
            <datalist id="unit-suggestions">
              {COMMON_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="meta">Notes (optional)</label>
            <input
              type="text"
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. one ladle"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="submit" className="btn green" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
        {err && <p className="meta text-red" style={{ marginTop: 8 }}>{err}</p>}
        <p className="meta" style={{ marginTop: 8, opacity: 0.7 }}>
          Saving the same (dish, recipe) pair updates the existing row. Dish names are stored canonical
          (lowercase + alphanumeric); the editor matches them case-insensitively.
        </p>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Existing components ({components.length})</h3>
        {grouped.length === 0 ? (
          <p className="meta">No dish_components rows yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Dish</th>
                <th>Recipe</th>
                <th>Qty / serving</th>
                <th>Unit</th>
                <th>Notes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([dish, rows]) =>
                rows.map((c, i) => (
                  <tr key={c.id}>
                    <td>{i === 0 ? <strong>{dish}</strong> : ''}</td>
                    <td>{c.recipe_slug}</td>
                    <td>{c.qty_per_serving}</td>
                    <td>{c.unit}</td>
                    <td className="meta">{c.notes || '—'}</td>
                    <td className="meta" style={{ fontSize: 11 }}>{(c.updated_at || '').slice(0, 16)}</td>
                    <td>
                      <button className="btn" onClick={() => remove(c.id)} title="Delete">
                        ×
                      </button>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
