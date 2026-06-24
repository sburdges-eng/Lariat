// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AddPrepParRow({ locationId = 'default' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cookId, setCookId] = useState('');

  const [recipeSlug, setRecipeSlug] = useState('');
  const [ingredient, setIngredient] = useState('');
  const [stationId, setStationId] = useState('');
  const [targetQty, setTargetQty] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const reset = () => {
    setRecipeSlug('');
    setIngredient('');
    setStationId('');
    setTargetQty('');
    setUnit('');
    setNote('');
  };

  const bothEmpty = !recipeSlug.trim() && !ingredient.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (bothEmpty) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/prep-par', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          station_id: stationId.trim(),
          recipe_slug: recipeSlug.trim(),
          ingredient: ingredient.trim(),
          target_qty: targetQty === '' ? null : Number(targetQty),
          unit: unit.trim() || null,
          note: note.trim() || null,
          cook_id: cookId,
        }),
      });
      if (!res.ok) {
        setErr('Did not save — try again.');
        setBusy(false);
        return;
      }
      reset();
      setBusy(false);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => setOpen(true)}
          aria-expanded="false"
        >
          + Add prep par target
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card" aria-busy={busy} style={{ marginBottom: 16 }}>
      <div className="form-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '2 1 240px' }}>
          <label className="label" htmlFor="ppar-recipe">Recipe</label>
          <input
            id="ppar-recipe"
            type="text"
            value={recipeSlug}
            onChange={(e) => setRecipeSlug(e.target.value)}
            placeholder="e.g. Beer Batter"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '2 1 240px' }}>
          <label className="label" htmlFor="ppar-ingredient">Ingredient</label>
          <input
            id="ppar-ingredient"
            type="text"
            value={ingredient}
            onChange={(e) => setIngredient(e.target.value)}
            placeholder="e.g. TOMATO, ROMA"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="label" htmlFor="ppar-station">Station</label>
          <input
            id="ppar-station"
            type="text"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            placeholder="Sauté, Grill…"
            className="input form-field"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="form-row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <div style={{ flex: '0 1 110px' }}>
          <label className="label" htmlFor="ppar-qty">Target qty</label>
          <input
            id="ppar-qty"
            type="number"
            inputMode="decimal"
            step="any"
            value={targetQty}
            onChange={(e) => setTargetQty(e.target.value)}
            className="input form-field"
          />
        </div>
        <div style={{ flex: '0 1 100px' }}>
          <label className="label" htmlFor="ppar-unit">Unit</label>
          <input
            id="ppar-unit"
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="lb, qt, ea"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '2 1 240px' }}>
          <label className="label" htmlFor="ppar-note">Note</label>
          <input
            id="ppar-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input form-field"
            maxLength={500}
            autoComplete="off"
          />
        </div>
      </div>

      {bothEmpty && (
        <p className="meta" style={{ marginTop: 8, color: 'var(--orange, #c0531c)' }}>
          Fill in Recipe or Ingredient.
        </p>
      )}

      {err && (
        <div role="alert" aria-live="assertive" style={{ color: 'var(--red)', marginTop: 12 }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="submit" className="btn primary lg" disabled={busy || bothEmpty}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => { reset(); setOpen(false); setErr(''); }}
          disabled={busy}
        >
          Cancel
        </button>
        <p className="meta" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          Fill Recipe or Ingredient — not both.
        </p>
      </div>
    </form>
  );
}
