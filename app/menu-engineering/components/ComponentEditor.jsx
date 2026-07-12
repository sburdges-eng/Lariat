// @ts-check
'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDollars } from '../../../lib/formatMoney';

/** @typedef {import('../../../lib/db.ts').DishComponent} DishComponent */

/**
 * Recipe candidate for the "Sub-recipe" component type — mirrors the shape
 * ComponentEditorPage derives from getRecipes() (slug/name plus the
 * recipe's declared menu_items, defaulted to [] there).
 * @typedef {{ slug: string, name: string, menu_items: string[] }} RecipeOption
 */

/**
 * Distributor/vendor item candidate for the "Distributor" component type.
 * Mirrors the local (non-exported) `VendorCandidate` interface in
 * ./page.tsx — kept in sync by hand since that interface isn't exported
 * for reuse.
 * @typedef {{
 *   ingredient: string,
 *   unit_price: number | null,
 *   pack_unit: string | null,
 *   source: 'vendor_prices' | 'order_guide',
 *   vendor: string | null,
 * }} VendorCandidate
 */

/**
 * One row in the "Build a dish" form. `qty` stays a string while being
 * edited (raw input value); only coerced to a number on save.
 * @typedef {{
 *   localId: string,
 *   componentType: 'recipe' | 'vendor_item',
 *   recipeSlug: string,
 *   vendorIngredient: string,
 *   qty: string,
 *   unit: string,
 *   notes: string,
 * }} ComponentRow
 */

const COMMON_UNITS = ['oz', 'g', 'lb', 'tsp', 'tbsp', 'cup', 'fl oz', 'qt', 'gal', 'each'];

let rowCounter = 0;
const nextRowId = () => `row-${++rowCounter}`;

/** @returns {ComponentRow} */
const emptyRow = () => ({
  localId: nextRowId(),
  componentType: 'recipe',          // 'recipe' | 'vendor_item'
  recipeSlug: '',
  vendorIngredient: '',
  qty: '',
  unit: 'oz',
  notes: '',
});

/** @param {ComponentRow} r */
const dupKey = (r) =>
  r.componentType === 'recipe'
    ? `recipe:${r.recipeSlug}`
    : `vendor:${(r.vendorIngredient || '').toLowerCase().trim()}`;

/** @param {DishComponent} c */
const componentKey = (c) =>
  c.component_type === 'recipe'
    ? `${c.dish_name}::recipe::${c.recipe_slug}`
    : `${c.dish_name}::vendor::${(c.vendor_ingredient || '').toLowerCase().trim()}`;

/**
 * Loose case/punctuation-insensitive dish-name match key — shared by the
 * "existing components for this dish name" live-match and the `?dish=`
 * deep-link resolver below (both need the same forgiving comparison,
 * since dish_components.dish_name is canonical-normalized on save but
 * neither the user's typed input nor a fix-it link's dish name is).
 * @param {string} s
 */
const normDishKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param {DishComponent} c
 * @returns {ComponentRow}
 */
const rowFromComponent = (c) => ({
  localId: nextRowId(),
  componentType: c.component_type,
  recipeSlug: c.recipe_slug || '',
  vendorIngredient: c.vendor_ingredient || '',
  qty: String(c.qty_per_serving),
  unit: c.unit,
  notes: c.notes || '',
});

/**
 * Resolve the `?dish=` deep-link query param against already-loaded
 * dish_components rows for this location, so the builder pre-selects that
 * dish on mount. /costing/depletion-exceptions builds a "fix-it" link to
 * `/menu-engineering/components?dish=<dish_name>&location=<loc>` expecting
 * this — before this fix the param was read nowhere and the link was a
 * silent no-op (the dish was still findable via the datalist, just not
 * pre-selected). Loose match (normDishKey) since the link's dish name is
 * the raw Toast sales_lines display string, not the canonical
 * normalizeDishName() form dish_components stores.
 *
 * @param {string | null} dishParam
 * @param {DishComponent[]} components
 * @returns {{ dishName: string, rows: ComponentRow[] }}
 */
function resolveDishParam(dishParam, components) {
  const raw = (dishParam || '').trim();
  if (!raw) return { dishName: '', rows: [emptyRow()] };
  const norm = normDishKey(raw);
  const matches = components.filter((c) => normDishKey(c.dish_name) === norm);
  if (matches.length === 0) return { dishName: raw, rows: [emptyRow()] };
  return {
    dishName: /** @type {DishComponent} */ (matches[0]).dish_name,
    rows: matches.map(rowFromComponent),
  };
}

/**
 * @param {{
 *   locationId: string,
 *   initialComponents: DishComponent[],
 *   recipes: RecipeOption[],
 *   distributorItems?: VendorCandidate[],
 *   unlinkedDishes?: string[],
 *   declaredOnlyDishes?: string[],
 * }} props
 */
export default function ComponentEditor({
  locationId,
  initialComponents,
  recipes,
  distributorItems,
  unlinkedDishes,
  declaredOnlyDishes,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [components, setComponents] = useState(initialComponents || []);
  const [dishName, setDishName] = useState(
    () => resolveDishParam(searchParams.get('dish'), initialComponents || []).dishName,
  );
  const [rows, setRows] = useState(
    () => resolveDishParam(searchParams.get('dish'), initialComponents || []).rows,
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rowErrs, setRowErrs] = useState(/** @type {Record<string, string>} */ ({}));
  const inFlightRef = useRef(false);

  const grouped = useMemo(() => {
    /** @type {Map<string, DishComponent[]>} */
    const map = new Map();
    for (const c of components) {
      if (!map.has(c.dish_name)) map.set(c.dish_name, []);
      /** @type {DishComponent[]} */ (map.get(c.dish_name)).push(c);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [components]);

  const candidateDishes = useMemo(() => {
    const set = /** @type {Set<string>} */ (new Set());
    for (const d of unlinkedDishes || []) set.add(d);
    for (const d of declaredOnlyDishes || []) set.add(d);
    for (const c of components) set.add(c.dish_name);
    return [...set].sort();
  }, [unlinkedDishes, declaredOnlyDishes, components]);

  const distributors = distributorItems || [];

  const existingForDish = useMemo(() => {
    if (!dishName.trim()) return [];
    const norm = normDishKey(dishName.trim());
    return components.filter((c) => normDishKey(c.dish_name) === norm);
  }, [components, dishName]);

  /**
   * @param {string} localId
   * @param {Partial<ComponentRow>} patch
   */
  const updateRow = (localId, patch) =>
    setRows((curr) => curr.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));

  const addRow = () => setRows((curr) => [...curr, emptyRow()]);

  /** @param {string} localId */
  const removeRow = (localId) =>
    setRows((curr) => (curr.length === 1 ? [emptyRow()] : curr.filter((r) => r.localId !== localId)));

  const loadExistingIntoRows = () => {
    if (existingForDish.length === 0) return;
    setRows(existingForDish.map(rowFromComponent));
    setErr('');
    setRowErrs({});
  };

  /**
   * @param {ComponentRow} r
   * @returns {string | null}
   */
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

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const saveAll = async (e) => {
    e?.preventDefault?.();
    if (inFlightRef.current) return;
    setErr('');
    setRowErrs({});

    if (!dishName.trim()) {
      setErr('Dish name required.');
      return;
    }
    const seen = /** @type {Set<string>} */ (new Set());
    const errs = /** @type {Record<string, string>} */ ({});
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
    const saved = /** @type {DishComponent[]} */ ([]);
    const rowFails = /** @type {Record<string, string>} */ ({});
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
          const j = /** @type {{ error?: string }} */ (await res.json().catch(() => ({})));
          rowFails[r.localId] = j?.error || `HTTP ${res.status}`;
          continue;
        }
        const j = /** @type {{ component: DishComponent }} */ (await res.json());
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
        /** @type {Map<string, DishComponent>} */
        const byKey = new Map();
        for (const c of curr) byKey.set(componentKey(c), c);
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

  /** @param {number} id */
  const remove = async (id) => {
    if (!window.confirm('Delete this component?')) return;
    try {
      const res = await fetch('/api/dish-components', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = /** @type {{ error?: string }} */ (await res.json().catch(() => ({})));
        setErr(j?.error || `Delete failed (HTTP ${res.status})`);
        return;
      }
      setComponents((curr) => curr.filter((c) => c.id !== id));
      router.refresh();
    } catch {
      setErr('Network error — retry');
    }
  };

  /** @param {string} dish */
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
                            componentType: /** @type {'recipe' | 'vendor_item'} */ (e.target.value),
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
                                ? `${d.vendor || '—'} · ${formatDollars(d.unit_price, { decimals: 3 })}/${d.pack_unit || '?'}`
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
