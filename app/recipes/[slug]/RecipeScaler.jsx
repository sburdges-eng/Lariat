'use client';
import { useState } from 'react';

function fmt(n) {
  if (typeof n !== 'number' || isNaN(n)) return '';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export default function RecipeScaler({ ingredients }) {
  const [scale, setScale] = useState(1);
  return (
    <>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom: 14 }}>
        <span className="scaler">
          <button className="btn" aria-label="Smaller batch" onClick={() => setScale(s => Math.max(0.25, +(s - 0.5).toFixed(2)))}>−</button>
          <input type="number" step="0.25" min="0.25" value={scale} aria-label="batch size" onChange={e => setScale(parseFloat(e.target.value) || 1)} />
          <button className="btn" aria-label="Bigger batch" onClick={() => setScale(s => +(s + 0.5).toFixed(2))}>+</button>
        </span>
        <span style={{ color:'var(--muted)', fontSize:14 }}>× batch</span>
      </div>
      <table className="ing-table">
        <thead>
          <tr><th>Ingredient</th><th>Quantity</th><th>Unit</th></tr>
        </thead>
        <tbody>
          {ingredients.map((i, idx) => {
            const qty = typeof i.qty === 'number' ? i.qty * scale : i.qty;
            return (
              <tr key={idx}>
                <td>{i.item}</td>
                <td style={{ fontWeight: 600 }}>{typeof qty === 'number' ? fmt(qty) : qty}</td>
                <td style={{ color:'var(--muted)' }}>{i.unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
