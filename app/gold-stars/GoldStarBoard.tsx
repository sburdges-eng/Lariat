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
        setSubmitError(body?.error || 'Did not save. Try again.');
        return;
      }
      const data = await res.json();
      if (!data?.ok) {
        setSubmitError(data?.error || 'Did not save. Check it and try again.');
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
    } catch {
      setSubmitError('Lost connection. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const removedAt = recognitions.findIndex(r => r.id === id);
    if (removedAt < 0) return;
    const removed = recognitions[removedAt];
    if (!removed) return;
    const target = removed;
    if (!window.confirm(`Remove this Gold Star for ${target.name}?`)) return;

    setRecognitions(list => list.filter(r => r.id !== id));
    try {
      const res = await fetch(`/api/gold-stars/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
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
    return <div className="gs-loading">Loading...</div>;
  }

  return (
    <div className="gs-root">
      <section className="gs-section">
        <div className="gs-header">
          <h1 className="gs-title">
            <span>★</span> Gold Stars
          </h1>
          <button onClick={openModal} className="gs-give-btn">
            Give a star
          </button>
        </div>

        <div className="gs-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={viewMode === 'recent' ? 'true' : 'false'}
            onClick={() => setViewMode('recent')}
            className="gs-tab"
          >
            Recent
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'leaderboard' ? 'true' : 'false'}
            onClick={() => setViewMode('leaderboard')}
            className="gs-tab"
          >
            Leaderboard
          </button>
        </div>

        <div className="gs-list">
          {viewMode === 'recent' && recognitions.map((record) => (
            <div key={record.id} className="gs-row">
              <div className="gs-row-info">
                <h3 className="gs-row-name">{record.name}</h3>
                <p className="gs-row-reason">{record.reason}</p>
                <span className="gs-row-date">Awarded: {record.date}</span>
              </div>
              <div className="gs-row-aside">
                <div className="gs-stars">
                  {'★'.repeat(record.stars)}
                </div>
                <button
                  onClick={() => handleDelete(record.id)}
                  className="gs-remove-btn"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {viewMode === 'leaderboard' && leaderboard.map((cook, index) => (
            <div key={cook.name} className="gs-lb-row">
              <div className="gs-lb-left">
                <span className={`gs-lb-rank ${index < 3 ? 'gs-lb-rank--top' : 'gs-lb-rank--rest'}`}>
                  #{index + 1}
                </span>
                <span className="gs-lb-name">{cook.name}</span>
              </div>
              <div className="gs-lb-total">
                {cook.totalStars} ★
              </div>
            </div>
          ))}

          {recognitions.length === 0 && (
            <div className="gs-empty">No stars awarded yet.</div>
          )}
        </div>
      </section>

      {isModalOpen && (
        <div
          onClick={() => setIsModalOpen(false)}
          className="gs-overlay"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="gs-modal"
          >
            <h3 className="gs-modal-title">Give a Gold Star</h3>

            {submitError && (
              <div role="alert" className="gs-error">
                {submitError}
              </div>
            )}

            <form onSubmit={submit}>
              <label htmlFor="gold-star-who" className="gs-label">
                Who
              </label>
              <select
                id="gold-star-who"
                value={selectedCook}
                onChange={(e) => setSelectedCook(e.target.value)}
                className="gs-input"
                required
              >
                <option value="" disabled>Pick a cook...</option>
                {roster.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>

              <label className="gs-label">How big a deal</label>
              <div className="gs-tiers">
                {STAR_TIERS.map(tier => (
                  <button
                    key={tier.val}
                    type="button"
                    onClick={() => setStarCount(tier.val)}
                    aria-pressed={starCount === tier.val ? 'true' : 'false'}
                    className="gs-tier-btn"
                  >
                    {tier.label}
                  </button>
                ))}
              </div>

              <label htmlFor="gold-star-reason" className="gs-label">
                What they did
              </label>
              <textarea
                id="gold-star-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="gs-input gs-textarea"
                placeholder="e.g., Handled the grill solo during the dinner rush without dropping a single ticket."
                required
              />

              <div className="gs-actions">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="gs-cancel-btn"
                >
                  Go back
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="gs-submit-btn"
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
