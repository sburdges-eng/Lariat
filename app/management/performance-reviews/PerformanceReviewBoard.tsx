'use client';
import React, { useEffect, useState } from 'react';
import { classifyReview } from '../../../lib/performanceReviews';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';

const SCORE_LABELS = ['Poor', 'Fair', 'Good', 'Great', 'Top Notch'];

export interface PerformanceReviewRecord {
  id: number;
  cook_name: string;
  cook_uuid: string | null;
  review_date: string;
  punctuality_score: number;
  technique_score: number;
  speed_score: number;
  notes: string | null;
  reviewer_name: string;
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

export default function PerformanceReviewBoard({
  locationId = DEFAULT_LOCATION_ID,
}: {
  locationId?: string;
}) {
  // Non-default locations must be threaded onto every
  // /api/performance-reviews request as `?location=` — the API's
  // GET/DELETE handlers resolve location scope from the URL query
  // (locationFromRequest) and the POST handler from the body
  // (locationFromBody). Same `locQ` convention as
  // app/labor/breaks/BreakBoard.jsx. /api/staff stays bare: the
  // roster is deliberately location-less.
  const locQ =
    locationId && locationId !== DEFAULT_LOCATION_ID
      ? `?location=${encodeURIComponent(locationId)}`
      : '';

  const [roster, setRoster] = useState<CookDisplay[]>([]);
  const [reviews, setReviews] = useState<PerformanceReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCook, setSelectedCook] = useState<CookDisplay | null>(null);
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().slice(0, 10));
  const [punctuality, setPunctuality] = useState(3);
  const [technique, setTechnique] = useState(3);
  const [speed, setSpeed] = useState(3);
  const [notes, setNotes] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/staff').then(r => r.json() as Promise<RosterItem[]>),
      fetch(`/api/performance-reviews${locQ}`).then(r => r.json() as Promise<PerformanceReviewRecord[]>),
    ])
      .then(([staff, records]) => {
        setRoster(
          (staff || [])
            .filter(s => s.active !== false)
            .map(s => ({ id: s.id, name: `${s.first} ${s.last}` }))
        );
        setReviews(records || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [locQ]);

  const openModal = () => {
    setSelectedCook(null);
    setReviewDate(new Date().toISOString().slice(0, 10));
    setPunctuality(3);
    setTechnique(3);
    setSpeed(3);
    setNotes('');
    setSubmitError(null);
    setIsModalOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCook || !reviewDate || !reviewerName) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/performance-reviews${locQ}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          cook_name: selectedCook.name,
          cook_uuid: selectedCook.id,
          review_date: reviewDate,
          punctuality_score: punctuality,
          technique_score: technique,
          speed_score: speed,
          notes,
          reviewer_name: reviewerName,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body?.error || 'Did not save. Try again.');
        return;
      }
      const data = await res.json();
      const newRecord: PerformanceReviewRecord = {
        id: data.id,
        cook_name: selectedCook.name,
        cook_uuid: selectedCook.id,
        review_date: reviewDate,
        punctuality_score: punctuality,
        technique_score: technique,
        speed_score: speed,
        notes,
        reviewer_name: reviewerName,
      };
      setReviews(prev => [newRecord, ...prev]);
      setIsModalOpen(false);
    } catch {
      setSubmitError('Lost connection. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this review?')) return;
    try {
      const res = await fetch(`/api/performance-reviews/${id}${locQ}`, { method: 'DELETE' });
      if (res.ok) {
        setReviews(prev => prev.filter(r => r.id !== id));
      }
    } catch {
      alert('Delete failed');
    }
  };

  const filtered = reviews.filter(r => 
    r.cook_name.toLowerCase().includes(search.toLowerCase()) ||
    (r.notes || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="pr-loading">Loading...</div>;

  return (
    <div className="pr-root">
      <section className="pr-section">
        <div className="pr-header">
          <h2 className="pr-title">Staff Reviews</h2>
          <button onClick={openModal} className="pr-give-btn">Log Review</button>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="text"
            placeholder="Search by cook or notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="gs-input"
            style={{ maxWidth: '400px' }}
          />
        </div>

        <div className="pr-list">
          {filtered.map(record => {
            const { average_score, status, label } = classifyReview(record);
            return (
              <div key={record.id} className="pr-row">
                <div className="pr-row-info">
                  <div className="pr-row-top">
                    <h3 className="pr-row-name">{record.cook_name}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`fs-tile-pip fs-tile-pip-${status}`} title={label} />
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: `var(--${status})` }}>
                        {average_score} - {label}
                      </span>
                    </div>
                    <span className="pr-row-date">{record.review_date}</span>
                  </div>
                  <div className="pr-scores">
                    <span className="pr-score">On Time: {record.punctuality_score}/5</span>
                    <span className="pr-score">Tech: {record.technique_score}/5</span>
                    <span className="pr-score">Speed: {record.speed_score}/5</span>
                  </div>
                  {record.notes && <p className="pr-row-notes">{record.notes}</p>}
                  <span className="pr-row-reviewer">By: {record.reviewer_name}</span>
                </div>
                <button onClick={() => handleDelete(record.id)} className="pr-remove-btn">Remove</button>
              </div>
            );
          })}
          {reviews.length > 0 && filtered.length === 0 && (
            <div className="pr-empty">No reviews match your search.</div>
          )}
          {reviews.length === 0 && <div className="pr-empty">No reviews logged yet.</div>}
        </div>
      </section>

      {isModalOpen && (
        <div className="gs-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="gs-modal" onClick={e => e.stopPropagation()}>
            <h3 className="gs-modal-title">Log Staff Review</h3>
            {submitError && <div className="gs-error">{submitError}</div>}
            <form onSubmit={submit}>
              <div className="pr-form-grid">
                <div>
                  <label className="gs-label">Who</label>
                  <select
                    value={selectedCook?.id || ''}
                    onChange={e => {
                      const c = roster.find(r => r.id === e.target.value);
                      setSelectedCook(c || null);
                    }}
                    className="gs-input"
                    required
                  >
                    <option value="" disabled>Pick a cook...</option>
                    {roster.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="gs-label">Date</label>
                  <input
                    type="date"
                    value={reviewDate}
                    onChange={e => setReviewDate(e.target.value)}
                    className="gs-input"
                    required
                  />
                </div>
              </div>

              <div className="pr-form-grid">
                <div>
                  <label className="gs-label">On Time (1-5)</label>
                  <select value={punctuality} onChange={e => setPunctuality(Number(e.target.value))} className="gs-input">
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} - {SCORE_LABELS[n-1]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="gs-label">Technique (1-5)</label>
                  <select value={technique} onChange={e => setTechnique(Number(e.target.value))} className="gs-input">
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} - {SCORE_LABELS[n-1]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="gs-label">Speed (1-5)</label>
                  <select value={speed} onChange={e => setSpeed(Number(e.target.value))} className="gs-input">
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} - {SCORE_LABELS[n-1]}</option>)}
                  </select>
                </div>
              </div>

              <label className="gs-label">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="gs-input gs-textarea"
                placeholder="How did they do?"
              />

              <label className="gs-label">Your Name</label>
              <input
                type="text"
                value={reviewerName}
                onChange={e => setReviewerName(e.target.value)}
                className="gs-input"
                placeholder="Manager Name"
                required
              />

              <div className="gs-actions">
                <button type="button" onClick={() => setIsModalOpen(false)} className="gs-cancel-btn">Go back</button>
                <button type="submit" disabled={saving} className="gs-submit-btn">
                  {saving ? 'Saving...' : 'Save Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
