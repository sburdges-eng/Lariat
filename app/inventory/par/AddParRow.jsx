'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AddParRow({ locationId = 'default', categories = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cookId, setCookId] = useState('');

  const [ingredient, setIngredient] = useState('');
  const [sku, setSku] = useState('');
  const [vendor, setVendor] = useState('');
  const [parQty, setParQty] = useState('');
  const [parUnit, setParUnit] = useState('');
  const [packSize, setPackSize] = useState('');
  const [packUnit, setPackUnit] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const reset = () => {
    setIngredient('');
    setSku('');
    setVendor('');
    setParQty('');
    setParUnit('');
    setPackSize('');
    setPackUnit('');
    setCategory('');
    setNote('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!ingredient.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/inventory/par', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ingredient: ingredient.trim(),
          sku: sku.trim() || null,
          vendor: vendor.trim() || null,
          par_qty: parQty === '' ? null : Number(parQty),
          par_unit: parUnit.trim() || null,
          pack_size: packSize.trim() || null,
          pack_unit: packUnit.trim() || null,
          category: category.trim() || null,
          note: note.trim() || null,
          cook_id: cookId,
          location_id: locationId,
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
          + Add par item
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card" aria-busy={busy} style={{ marginBottom: 16 }}>
      <div className="form-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '2 1 240px' }}>
          <label className="label" htmlFor="par-ingredient">Ingredient</label>
          <input
            id="par-ingredient"
            type="text"
            value={ingredient}
            onChange={(e) => setIngredient(e.target.value)}
            placeholder="e.g. TOMATO, ROMA"
            className="input form-field"
            autoComplete="off"
            required
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="label" htmlFor="par-sku">SKU</label>
          <input
            id="par-sku"
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label className="label" htmlFor="par-vendor">Vendor</label>
          <input
            id="par-vendor"
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Shamrock, Sysco…"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label className="label" htmlFor="par-category">Category</label>
          <input
            id="par-category"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Produce, Dairy…"
            className="input form-field"
            list="par-category-list"
            autoComplete="off"
          />
          {categories.length > 0 && (
            <datalist id="par-category-list">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          )}
        </div>
      </div>

      <div className="form-row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <div style={{ flex: '0 1 110px' }}>
          <label className="label" htmlFor="par-qty">Par qty</label>
          <input
            id="par-qty"
            type="number"
            inputMode="decimal"
            step="any"
            value={parQty}
            onChange={(e) => setParQty(e.target.value)}
            className="input form-field"
          />
        </div>
        <div style={{ flex: '0 1 100px' }}>
          <label className="label" htmlFor="par-unit">Par unit</label>
          <input
            id="par-unit"
            type="text"
            value={parUnit}
            onChange={(e) => setParUnit(e.target.value)}
            placeholder="lb, ea, qt"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '0 1 130px' }}>
          <label className="label" htmlFor="par-pack-size">Pack size</label>
          <input
            id="par-pack-size"
            type="text"
            value={packSize}
            onChange={(e) => setPackSize(e.target.value)}
            placeholder="case of 24"
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '0 1 100px' }}>
          <label className="label" htmlFor="par-pack-unit">Pack unit</label>
          <input
            id="par-pack-unit"
            type="text"
            value={packUnit}
            onChange={(e) => setPackUnit(e.target.value)}
            className="input form-field"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: '2 1 240px' }}>
          <label className="label" htmlFor="par-note">Note</label>
          <input
            id="par-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input form-field"
            maxLength={500}
            autoComplete="off"
          />
        </div>
      </div>

      {err && (
        <div role="alert" aria-live="assertive" style={{ color: 'var(--red)', marginTop: 12 }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="submit" className="btn primary lg" disabled={busy || !ingredient.trim()}>
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
          Saving the same ingredient + SKU updates the existing row.
        </p>
      </div>
    </form>
  );
}
