'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const STAR_TIERS = [
  { val: 1, label: '★ Good' },
  { val: 2, label: '★★ Great' },
  { val: 3, label: '★★★ Exceptional' },
];

export interface RecognitionRecord {
  id: number;
  name: string;
  reason: string;
  stars: number;
  awardedDate: string;
  date: string;
}

export interface DBRow {
  id: number;
  cook_name: string;
  reason: string;
  stars?: number;
  awarded_date: string;
}

export interface RosterItem {
  id: string;
  first: string;
  last: string;
  active?: boolean;
}

export interface CookDisplay {
  id: string;
  name: string;
}

function formatAwardedDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function mapRowToRecord(row: DBRow): RecognitionRecord {
  return {
    id: row.id,
    name: row.cook_name,
    reason: row.reason,
    stars: row.stars || 1,
    awardedDate: row.awarded_date,
    date: formatAwardedDate(row.awarded_date),
  };
}

export default function GoldStarBoard() {
  const [roster, setRoster] = useState<CookDisplay[]>([]);
  const [recognitions, setRecognitions] = useState<RecognitionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<'recent' | 'leaderboard'>('recent');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [selectedCook, setSelectedCook] = useState('');
  const [reason, setReason] = useState('');
  const [starCount, setStarCount] = useState(1);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/staff').then(r => r.json() as Promise<RosterItem[]>),
      fetch('/api/gold-stars').then(r => r.json() as Promise<DBRow[]>),
    ])
      .then(([staff, stars]) => {
        setRoster(
          (staff || [])
            .filter(s => s.active !== false)
            .map(s => ({ id: s.id, name: `${s.first} ${s.last}` }))
        );
        setRecognitions((stars || []).map(mapRowToRecord));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const leaderboard = useMemo(() => {
    const stats = recognitions.reduce((acc, r) => {
      acc[r.name] = (acc[r.name] || 0) + (r.stars || 0);
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(stats)
      .map(([name, totalStars]) => ({ name, totalStars }))
      .sort((a, b) => b.totalStars - a.totalStars);
  }, [recognitions]);

  const openModal = useCallback(() => {
    setSelectedCook('');
    setReason('');
    setStarCount(1);
    setSubmitError(null);
    setIsModalOpen(true);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!selectedCook || !trimmed) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/gold-stars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cook_name: selectedCook,
          reason: trimmed,
          stars: starCount,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body?.error || `Could not save (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      if (!data?.ok) {
        setSubmitError(data?.error || 'Server declined the save — check and try again.');
        return;
      }
      const todayISO = new Date().toISOString().slice(0, 10);
      setRecognitions(prev => [
        {
          id: data.id,
          name: selectedCook,
          reason: trimmed,
          stars: starCount,
          awardedDate: todayISO,
          date: formatAwardedDate(todayISO),
        },
        ...prev,
      ]);
      setViewMode('recent');
      setIsModalOpen(false);
    } catch (err) {
      setSubmitError('Network error — try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    // Capture the row + its position via a functional updater so the
    // rollback path doesn't depend on the render-time closure of
    // `recognitions` — under rapid-fire deletes the closure value
    // could be stale by the time this handler fires.
    let removed: RecognitionRecord | null = null;
    let removedAt = -1;
    setRecognitions(list => {
      const i = list.findIndex(r => r.id === id);
      if (i < 0) return list;
      removed = list[i];
      removedAt = i;
      return list.filter(r => r.id !== id);
    });
    if (!removed) return;
    try {
      const res = await fetch(`/api/gold-stars/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete failed (HTTP ${res.status})`);
    } catch {
      // Re-insert at the original index (best effort — other deletes
      // may have reshuffled the list by the time we roll back).
      setRecognitions(list => {
        if (list.some(r => r.id === id)) return list;
        const next = list.slice();
        next.splice(Math.min(removedAt, next.length), 0, removed as RecognitionRecord);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
        Loading...
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '1rem', backgroundColor: '#374151', border: '1px solid #4b5563',
    borderRadius: '0.5rem', color: '#f3f4f6', marginBottom: '1rem', boxSizing: 'border-box',
    fontSize: '1rem',
  };

  return (
    <div style={{ position: 'relative', fontFamily: 'system-ui, sans-serif' }}>
      <section style={{
        backgroundColor: 'transparent', padding: '0',
        color: '#f3f4f6', maxWidth: '600px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid #374151', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#fde047', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>★</span> Gold Stars
          </h2>
          <button
            onClick={openModal}
            style={{ backgroundColor: 'transparent', color: '#eab308', border: '1px solid #ca8a04', padding: '0.5rem 1.25rem', borderRadius: '9999px', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
          >
            Give a star
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '1px solid #374151', marginBottom: '1rem' }}>
          <button
            onClick={() => setViewMode('recent')}
            style={{
              padding: '0.5rem 0', border: 'none', cursor: 'pointer',
              fontWeight: 500, transition: 'all 0.2s', backgroundColor: 'transparent',
              borderBottom: viewMode === 'recent' ? '2px solid #eab308' : '2px solid transparent',
              color: viewMode === 'recent' ? '#f3f4f6' : '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Recent Feed
          </button>
          <button
            onClick={() => setViewMode('leaderboard')}
            style={{
              padding: '0.5rem 0', border: 'none', cursor: 'pointer',
              fontWeight: 500, transition: 'all 0.2s', backgroundColor: 'transparent',
              borderBottom: viewMode === 'leaderboard' ? '2px solid #eab308' : '2px solid transparent',
              color: viewMode === 'leaderboard' ? '#f3f4f6' : '#9ca3af',
              fontSize: '1rem',
            }}
          >
            Leaderboard
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {viewMode === 'recent' && recognitions.map((record) => (
            <div key={record.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '1.25rem 0', borderBottom: '1px solid #1f2937' }}>
              <div style={{ flex: 1, minWidth: 0, paddingRight: '1rem' }}>
                <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1.25rem', fontWeight: 600, color: '#f3f4f6' }}>{record.name}</h3>
                <p style={{ margin: 0, color: '#d1d5db', fontSize: '1rem', lineHeight: '1.5' }}>{record.reason}</p>
                <span style={{ display: 'block', marginTop: '0.5rem', color: '#6b7280', fontSize: '0.875rem' }}>Awarded: {record.date}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem', marginTop: '0.25rem' }}>
                <div style={{ color: '#eab308', fontSize: '1.25rem', letterSpacing: '0.05em' }}>
                  {'★'.repeat(record.stars)}
                </div>
                <button
                  onClick={() => handleDelete(record.id)}
                  style={{ backgroundColor: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.875rem', transition: 'color 0.2s', padding: 0 }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {viewMode === 'leaderboard' && leaderboard.map((cook, index) => (
            <div key={cook.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderBottom: '1px solid #1f2937' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ color: index < 3 ? '#eab308' : '#4b5563', fontSize: '1.125rem', fontWeight: 600, width: '24px' }}>
                  #{index + 1}
                </span>
                <span style={{ color: '#f3f4f6', fontSize: '1.25rem', fontWeight: 600 }}>{cook.name}</span>
              </div>
              <div style={{ color: '#fde047', fontWeight: 600, fontSize: '1.125rem' }}>
                {cook.totalStars} ★
              </div>
            </div>
          ))}

          {recognitions.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>No stars awarded yet.</div>
          )}
        </div>
      </section>

      {isModalOpen && (
        <div
          onClick={() => setIsModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 50, padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: '#111827', padding: '2rem', borderRadius: '1rem', width: '100%', maxWidth: 450, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
          >
            <h3 style={{ margin: '0 0 1.5rem 0', color: '#f3f4f6', fontSize: '1.5rem', fontWeight: 600 }}>Give a Gold Star</h3>

            {submitError && (
              <div
                role="alert"
                style={{
                  padding: '0.75rem 1rem', marginBottom: '1rem',
                  backgroundColor: '#451a1a', border: '1px solid #7f1d1d',
                  borderRadius: '0.5rem', color: '#fca5a5', fontSize: '0.9rem',
                }}
              >
                {submitError}
              </div>
            )}

            <form onSubmit={submit}>
              <label
                htmlFor="gold-star-who"
                style={{ display: 'block', marginBottom: '0.5rem', color: '#9ca3af', fontWeight: 500 }}
              >
                Who
              </label>
              <select
                id="gold-star-who"
                value={selectedCook}
                onChange={(e) => setSelectedCook(e.target.value)}
                style={inputStyle}
                required
              >
                <option value="" disabled>Choose team member...</option>
                {roster.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>

              <label style={{ display: 'block', marginBottom: '0.5rem', color: '#9ca3af', fontWeight: 500 }}>How big a deal</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {STAR_TIERS.map(tier => (
                  <button
                    key={tier.val}
                    type="button"
                    onClick={() => setStarCount(tier.val)}
                    style={{
                      flex: 1, padding: '1rem 0',
                      backgroundColor: starCount === tier.val ? '#ca8a04' : '#1f2937',
                      color: starCount === tier.val ? 'white' : '#9ca3af',
                      border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600,
                      transition: 'all 0.15s',
                    }}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>

              <label
                htmlFor="gold-star-reason"
                style={{ display: 'block', marginBottom: '0.5rem', color: '#9ca3af', fontWeight: 500 }}
              >
                What they did
              </label>
              <textarea
                id="gold-star-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ ...inputStyle as React.CSSProperties, minHeight: 100, resize: 'vertical' }}
                placeholder="e.g., Handled the grill solo during the dinner rush without dropping a single ticket."
                required
              />

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{ flex: 1, padding: '1rem', backgroundColor: 'transparent', border: '1px solid #4b5563', color: '#d1d5db', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600, fontSize: '1rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ flex: 2, padding: '1rem', backgroundColor: '#eab308', border: 'none', color: '#713f12', fontWeight: 'bold', borderRadius: '0.5rem', cursor: saving ? 'wait' : 'pointer', fontSize: '1rem', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? 'Saving...' : 'Give it'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
