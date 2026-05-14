// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

/**
 * Recipe / product photo uploader.
 *
 * Used on the recipe edit page. Talks to:
 *   GET    /api/recipes/:slug/photos
 *   POST   /api/recipes/:slug/photos        (multipart, PIN-gated)
 *   DELETE /api/recipes/:slug/photos/:id    (PIN-gated)
 *
 * Drag-drop or file-picker. Multi-file upload posts files serially so
 * each failure is surfaced individually (a single batch reject would
 * lose successful files; uploads are not transactional across files).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif';

function bytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RecipePhotoUploader({ slug }) {
  const inputRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/recipes/${slug}/photos`, { cache: 'no-store' });
      const json = await res.json();
      setPhotos(json.photos || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setError('');
    setUploading(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/recipes/${slug}/photos`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `upload failed (HTTP ${res.status})`);
        }
      }
      await refresh();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [slug, refresh]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDelete = useCallback(async (id) => {
    if (!confirm('Delete this photo? The file stays on disk for audit.')) return;
    setError('');
    try {
      const res = await fetch(`/api/recipes/${slug}/photos/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `delete failed (HTTP ${res.status})`);
      }
      await refresh();
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [slug, refresh]);

  return (
    <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--serif, inherit)', fontSize: 22, fontWeight: 400 }}>
          Product photos
        </h2>
        <span style={{ fontFamily: 'var(--mono, inherit)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          {photos.length} on file
        </span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current && inputRef.current.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--ember)' : 'var(--border)'}`,
          background: dragOver ? 'rgba(200,90,42,0.06)' : 'var(--panel)',
          borderRadius: 8,
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: 13,
          cursor: uploading ? 'wait' : 'pointer',
          transition: 'border-color .15s, background .15s',
          marginBottom: 16,
        }}
      >
        {uploading ? 'Uploading…' : 'Drop photos here or click to pick.'}
        <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
          JPEG · PNG · WebP · HEIC · GIF · max 10&nbsp;MB
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 12, color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : photos.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
          No photos yet.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          {photos.map((p) => (
            <figure
              key={p.id}
              style={{
                margin: 0,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <a
                href={`/api/recipes/${slug}/photos/${p.id}/raw`}
                target="_blank"
                rel="noreferrer"
                style={{ aspectRatio: '4 / 3', display: 'block', background: 'var(--paper-2, #e3d8c1)' }}
              >
                <img
                  src={`/api/recipes/${slug}/photos/${p.id}/raw`}
                  alt={p.caption || p.original_name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </a>
              <figcaption style={{ padding: '8px 10px', fontSize: 12, color: 'var(--char)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.caption || p.original_name}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontFamily: 'var(--mono, inherit)', fontSize: 10, letterSpacing: '0.08em' }}>
                  <span>{bytes(p.size_bytes)}</span>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#991b1b',
                      fontSize: 11,
                      cursor: 'pointer',
                      padding: 0,
                      fontFamily: 'inherit',
                    }}
                  >
                    delete
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
