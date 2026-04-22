'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const COMMON_UNITS = ['oz', 'g', 'lb', 'tsp', 'tbsp', 'cup', 'fl oz', 'qt', 'gal', 'each'];

let rowCounter = 0;
const nextRowId = () => `row-${++rowCounter}`;
const emptyRow = () => ({
  localId: nextRowId(),
  componentType: 'recipe',          // 'recipe' | 'vendor_item'
  recipeSlug: '',
  vendorIngredient: '',
  qty: '',
  unit: 'oz',
  notes: '',
});

const dupKey = (r) =>
  r.componentType === 'recipe'
    ? `recipe:${r.recipeSlug}`
    : `vendor:${(r.vendorIngredient || '').toLowerCase().trim()}`;

const componentKey = (c) =>
  c.component_type === 'recipe'
    ? `${c.dish_name}::recipe::${c.recipe_slug}`
    : `${c.dish_name}::vendor::${(c.vendor_ingredient || '').toLowerCase().trim()}`;

export default function ComponentEditor({
  locationId,
  initialComponents,
  recipes,
  distributorItems,
  unlinkedDishes,
  declaredOnlyDishes,
}) {
  const router = useRouter();
  const [components, setComponents] = useState(initialComponents || []);
  const [dishName, setDishName] = useState('');
  const [rows, setRows] = useState([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rowErrs, setRowErrs] = useState({});
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
    const set = new Set();
    for (const d of unlinkedDishes || []) set.add(d);
    for (const d of declaredOnlyDishes || []) set.add(d);
    for (const c of components) set.add(c.dish_name);
    return [...set].sort();
  }, [unlinkedDishes, declaredOnlyDishes, components]);

  const distributors = distributorItems || [];

  const existingForDish = useMemo(() => {
    if (!dishName.trim()) return [];
    const norm = dishName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return components.filter(
      (c) => c.dish_name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm,
    );
  }, [components, dishName]);

  const updateRow = (localId, patch) =>
    setRows((curr) => curr.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));

  const addRow = () => setRows((curr) => [...curr, emptyRow()]);

  const removeRow = (localId) =>
    setRows((curr) => (curr.length === 1 ? [emptyRow()] : curr.filter((r) => r.localId !== localId)));

  const rowFromComponent = (c) => ({
    localId: nextRowId(),
    componentType: c.component_type,
    recipeSlug: c.recipe_slug || '',
    vendorIngredient: c.vendor_ingredient || '',
    qty: String(c.qty_per_serving),
    unit: c.unit,
    notes: c.notes || '',
  });

  const loadExistingIntoRows = () => {
    if (existingForDish.length === 0) return;
    setRows(existingForDish.map(rowFromComponent));
    setErr('');
    setRowErrs({});
  };

  const validateRow = (r) => {
    if (r.componentType === 'recipe') {
      if (!r.recipeSlug) return 'Choose a recipe.';
    } else {
      if (!r.vendorIngredient.trim()) return 'Choose a distributor item.';
    }
    if (!r.qty) return 'Qty required.';
    const n = Number(r.qty);
    if (!Number.isFinite(n) || n <= 0) return 'Qty must be positive.';
    if (!r.unit.trim()) return 'Unit required.';
    return null;
  };

  const saveAll = async (e) => {
    e?.preventDefault?.();
    if (inFlightRef.current) return;
    setErr('');
    setRowErrs({});

    if (!dishName.trim()) {
      setErr('Dish name required.');
      return;
    }
    const seen = new Set();
    const errs = {};
    rows.forEach((r) => {
      const k = dupKey(r);
      const isFilled =
        (r.componentType === 'recipe' && r.recipeSlug) ||
        (r.componentType === 'vendor_item' && r.vendorIngredient);
      if (isFilled && seen.has(k)) {
        errs[r.localId] = 'Duplicate component in this dish.';
      } else if (isFilled) {
        seen.add(k);
      }
      const msg = validateRow(r);
      if (msg) errs[r.localId] = errs[r.localId] || msg;
    });
    if (Object.keys(errs).length) {
      setRowErrs(errs);
      setErr('Fix the highlighted rows.');
      return;
    }

    inFlightRef.current = true;
    setSaving(true);
    const saved = [];
    const rowFails = {};
    try {
      for (const r of rows) {
        const payload =
          r.componentType === 'recipe'
            ? {
                location_id: locationId,
                dish_name: dishName.trim(),
                component_type: 'recipe',
                recipe_slug: r.recipeSlug,
                qty_per_serving: Number(r.qty),
                unit: r.unit.trim(),
                notes: r.notes.trim() || null,
              }
            : {
                location_id: locationId,
                dish_name: dishName.trim(),
                component_type: 'vendor_item',
                vendor_ingredient: r.vendorIngredient.trim(),
                qty_per_serving: Number(r.qty),
                unit: r.unit.trim(),
                notes: r.notes.trim() || null,
              };
        const res = await fetch('/api/dish-components', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          rowFails[r.localId] = j?.error || `HTTP ${res.status}`;
          continue;
        }
        const j = await res.json();
        saved.push(j.component);
      }
    } catch {
      setErr('Network error — some rows may not have saved.');
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }

    if (saved.length) {
      setComponents((curr) => {
        const byKey = new Map(curr.map((c) => [componentKey(c), c]));
        for (const s of saved) byKey.set(componentKey(s), s);
        return [...byKey.values()];
      });
    }
    if (Object.keys(rowFails).length) {
      setRowErrs(rowFails);
      setErr(`Saved ${saved.length} of ${rows.length}. Fix failed rows and Save again.`);
    } else {
      setDishName('');
      setRows([emptyRow()]);
      router.refresh();
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

  const editDish = (dish) => {
    setDishName(dish);
    const rowsForDish = components.filter((c) => c.dish_name === dish).map(rowFromComponent);
    setRows(rowsForDish.length ? rowsForDish : [emptyRow()]);
    setErr('');
    setRowErrs({});
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div>
      <div className="card mb-20">
        <h3 style={{ marginTop: 0 }}>Build a dish</h3>
        <form onSubmit={saveAll}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
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
            {existingForDish.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={loadExistingIntoRows}
                title="Replace rows with this dish's existing components"
              >
                Load {existingForDish.length} existing
              </button>
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <label className="meta">Components — sub-recipes AND raw distributor items (buns, patties, cheese)</label>
            <div style={{ display: 'grid', gap: 8 }}>
              {rows.map((r, idx) => {
                const rowErr = rowErrs[r.localId];
                return (
                  <div key={r.localId}>
                    <div
                      style={{
                        display: 'grid',
                        gap: 8,
                        gridTemplateColumns: '120px 1fr 110px 110px 1fr auto',
                        alignItems: 'center',
                      }}
                    >
                      <select
                        className="input"
                        value={r.componentType}
                        onChange={(e) =>
                          updateRow(r.localId, {
                            componentType: e.target.value,
                            recipeSlug: '',
                            vendorIngredient: '',
                          })
                        }
                        aria-label={`Type for component ${idx + 1}`}
                      >
                        <option value="recipe">Sub-recipe</option>
                        <option value="vendor_item">Distributor</option>
                      </select>

                      {r.componentType === 'recipe' ? (
                        <select
                          className="input"
                          value={r.recipeSlug}
                          onChange={(e) => updateRow(r.localId, { recipeSlug: e.target.value })}
                          aria-label={`Recipe for component ${idx + 1}`}
                        >
                          <option value="">— choose recipe —</option>
                          {recipes.map((rc) => (
                            <option key={rc.slug} value={rc.slug}>
                              {rc.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="input"
                          value={r.vendorIngredient}
                          onChange={(e) => updateRow(r.localId, { vendorIngredient: e.target.value })}
                          list={`distributor-suggestions-${r.localId}`}
                          placeholder="e.g. Brioche Bun, 8oz Burger Patty, Cheese American Slice"
                          aria-label={`Distributor item for component ${idx + 1}`}
                        />
                      )}
                      {/* per-row datalist so each row binds independently */}
                      {r.componentType === 'vendor_item' && (
                        <datalist id={`distributor-suggestions-${r.localId}`}>
                          {distributors.map((d) => (
                            <option key={d.ingredient} value={d.ingredient}>
                              {d.unit_price != null
                                ? `${d.vendor || '—'} · $${d.unit_price.toFixed(3)}/${d.pack_unit || '?'}`
                                : `${d.vendor || '—'} · no price`}
                            </option>
                          ))}
                        </datalist>
                      )}

                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        className="input"
                        placeholder="qty"
                        value={r.qty}
                        onChange={(e) => updateRow(r.localId, { qty: e.target.value })}
                        aria-label={`Qty for component ${idx + 1}`}
                      />
                      <input
                        type="text"
                        className="input"
                        value={r.unit}
                        onChange={(e) => updateRow(r.localId, { unit: e.target.value })}
                        list="unit-suggestions"
                        aria-label={`Unit for component ${idx + 1}`}
                      />
                      <input
                        type="text"
                        className="input"
                        placeholder="notes (optional)"
                        value={r.notes}
                        onChange={(e) => updateRow(r.localId, { notes: e.target.value })}
                        aria-label={`Notes for component ${idx + 1}`}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => removeRow(r.localId)}
                        title="Remove this component"
                        aria-label={`Remove component ${idx + 1}`}
                      >
                        ×
                      </button>
                    </div>
                    {rowErr && (
                      <p className="meta text-red" style={{ marginTop: 4, marginLeft: 4 }}>
                        {rowErr}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <datalist id="unit-suggestions">
              {COMMON_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <button type="button" className="btn" style={{ marginTop: 10 }} onClick={addRow}>
              + Add component
            </button>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" className="btn green" disabled={saving}>
              {saving ? 'Saving…' : `Save ${rows.length} component${rows.length === 1 ? '' : 's'}`}
            </button>
            {err && <span className="meta text-red">{err}</span>}
          </div>
        </form>
        <p className="meta" style={{ marginTop: 10, opacity: 0.7 }}>
          Distributor items pull pricing from <code>vendor_prices</code> (preferred) or
          <code> order_guide_items</code> — pick one with $ in the dropdown if you can.
          Saving (dish, component) pairs upserts existing rows. Dish names stored canonical
          (lowercase + alphanumeric); the editor matches case-insensitively.
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
                <th>Type</th>
                <th>Component</th>
                <th>Qty / serving</th>
                <th>Unit</th>
                <th>Notes</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([dish, dishRows]) =>
                dishRows.map((c, i) => (
                  <tr key={c.id}>
                    <td>
                      {i === 0 ? (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '2px 8px', fontWeight: 600 }}
                          onClick={() => editDish(dish)}
                          title="Load into builder to edit all components"
                        >
                          {dish}
                        </button>
                      ) : (
                        ''
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color:
                            c.component_type === 'vendor_item' ? 'var(--blue)' : 'var(--green)',
                        }}
                      >
                        {c.component_type === 'vendor_item' ? 'distributor' : 'recipe'}
                      </span>
                    </td>
                    <td>{c.recipe_slug || c.vendor_ingredient}</td>
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
