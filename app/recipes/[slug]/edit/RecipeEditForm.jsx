// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { humanize } from '../../../../lib/userError';
import RecipePhotoUploader from './RecipePhotoUploader.jsx';

export default function RecipeEditForm({ slug }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [procedures, setProcedures] = useState('');
  const [allergens, setAllergens] = useState('');
  const [ingredients, setIngredients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Load recipe data on mount via API (not fs — this is a client component)
  useEffect(() => {
    fetch('/api/recipes')
      .then(r => r.json())
      .then(recipes => {
        const recipe = (recipes || []).find(r => r.slug === slug);
        if (recipe) {
          setName(recipe.name || '');
          setProcedures((recipe.procedures || []).join('\n'));
          setAllergens((recipe.allergens || []).join(', '));
          setIngredients((recipe.ingredients || []).map(i => ({
            item: i.item || '',
            quantity: i.quantity || '',
            unit: i.unit || ''
          })));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  const handleAddIngredient = () => {
    setIngredients([...ingredients, { item: '', quantity: '', unit: '' }]);
  };

  const handleRemoveIngredient = (index) => {
    setIngredients(ingredients.filter((_, i) => i !== index));
  };

  const handleIngredientChange = (index, field, value) => {
    const updated = [...ingredients];
    updated[index][field] = value;
    setIngredients(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      if (!name.trim()) {
        throw new Error('Recipe name is required');
      }

      const res = await fetch(`/api/recipes/${slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          procedures: procedures.split('\n').filter(p => p.trim()),
          allergens: allergens.split(',').map(a => a.trim()).filter(Boolean),
          ingredients: ingredients.filter(ing => ing.item.trim()),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save recipe');
      }

      await res.json();
      setSaving(false);
      router.push(`/recipes/${slug}`);
      router.refresh();
    } catch (err) {
      console.error('RecipeEditForm save failed:', err);
      setError(humanize(err));
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading recipe…</div>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 600, margin: '0 auto' }}>
      {error && (
        <div
          style={{
            background: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid #dc2626',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 20,
            color: '#991b1b',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: 6 }}>Recipe Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 14,
          }}
          required
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: 6 }}>Procedures</label>
        <textarea
          value={procedures}
          onChange={(e) => setProcedures(e.target.value)}
          rows={6}
          placeholder="One procedure per line"
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: 6 }}>Allergens</label>
        <input
          type="text"
          value={allergens}
          onChange={(e) => setAllergens(e.target.value)}
          placeholder="Comma-separated (e.g., Dairy, Nuts, Gluten)"
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 14,
          }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Ingredients</label>
          <button
            type="button"
            onClick={handleAddIngredient}
            style={{
              padding: '6px 12px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + Add
          </button>
        </div>

        {ingredients.map((ing, idx) => (
          <div
            key={idx}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 80px auto',
              gap: 8,
              marginBottom: 8,
              alignItems: 'end',
            }}
          >
            <input
              type="text"
              value={ing.item}
              onChange={(e) => handleIngredientChange(idx, 'item', e.target.value)}
              placeholder="Ingredient name"
              style={{
                padding: '8px 10px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
            <input
              type="text"
              value={ing.quantity}
              onChange={(e) => handleIngredientChange(idx, 'quantity', e.target.value)}
              placeholder="Qty"
              style={{
                padding: '8px 10px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
            <input
              type="text"
              value={ing.unit}
              onChange={(e) => handleIngredientChange(idx, 'unit', e.target.value)}
              placeholder="Unit"
              style={{
                padding: '8px 10px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
            <button
              type="button"
              onClick={() => handleRemoveIngredient(idx)}
              style={{
                padding: '6px 10px',
                background: 'rgba(220, 38, 38, 0.1)',
                color: '#991b1b',
                border: '1px solid #fecaca',
                borderRadius: 4,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: 'var(--ember)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Recipe'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={saving}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: 'var(--panel)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          Cancel
        </button>
      </div>

      <RecipePhotoUploader slug={slug} />
    </form>
  );
}
