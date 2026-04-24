'use client';

import { useEffect, useState } from 'react';
import { useRole } from '../../_components/RoleProvider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AuditLogPage() {
  const { canViewFinancials } = useRole();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [filterAction, setFilterAction] = useState('');
  const [filterSlug, setFilterSlug] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!canViewFinancials) {
      router.push('/recipes');
    }
  }, [canViewFinancials, router]);

  if (!canViewFinancials) {
    return null;
  }

  const fetchAuditLog = async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (filterAction) params.append('action', filterAction);
      if (filterSlug) params.append('slug', filterSlug);

      const response = await fetch(`/api/audit/log?${params}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch audit log: ${response.statusText}`);
      }

      const data = await response.json();
      setLogs(data.logs || []);
      setError(null);
    } catch (err) {
      setError(err.message);
      setLogs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAuditLog();
  }, [filterAction, filterSlug]);

  const uniqueActions = Array.from(
    new Set(logs.map(log => log.action))
  ).sort();

  const uniqueSlugs = Array.from(
    new Set(logs.map(log => log.slug).filter(Boolean))
  ).sort();

  const handleToggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div>
      <h1>Management Audit Log</h1>
      <p className="subtitle">
        Track all management actions including recipe edits, cost updates, and logins.
      </p>

      {/* Filter Controls */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 500 }}>
            Filter by action
          </label>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 14,
            }}
          >
            <option value="">All actions</option>
            {uniqueActions.map(action => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 500 }}>
            Filter by recipe
          </label>
          <select
            value={filterSlug}
            onChange={(e) => setFilterSlug(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 14,
            }}
          >
            <option value="">All recipes</option>
            {uniqueSlugs.map(slug => (
              <option key={slug} value={slug}>{slug}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            onClick={fetchAuditLog}
            disabled={refreshing || loading}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: refreshing || loading ? 'not-allowed' : 'pointer',
              opacity: refreshing || loading ? 0.6 : 1,
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div
          style={{
            background: 'rgba(220, 53, 69, 0.1)',
            border: '1px solid rgba(220, 53, 69, 0.3)',
            padding: 12,
            borderRadius: 6,
            marginBottom: 24,
            color: 'var(--red)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--muted)',
          }}
        >
          <p>Loading audit log…</p>
        </div>
      )}

      {/* Logs Table */}
      {!loading && logs.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--muted)',
            background: 'var(--panel-2)',
            borderRadius: 6,
          }}
        >
          <p>No audit logs found.</p>
        </div>
      ) : (
        !loading && (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Action</th>
                  <th style={{ width: 150 }}>Recipe</th>
                  <th style={{ width: 180 }}>Timestamp</th>
                  <th style={{ width: 100, textAlign: 'center' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isExpanded = expandedId === log.audit_id;
                  return (
                    <tbody key={log.audit_id}>
                      <tr
                        style={{
                          background: isExpanded ? 'rgba(200, 90, 42, 0.05)' : 'inherit',
                        }}
                      >
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              background: 'rgba(200, 90, 42, 0.2)',
                              color: 'var(--ember)',
                              padding: '2px 8px',
                              borderRadius: 3,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td>
                          {log.slug ? (
                            <Link
                              href={`/recipes/${log.slug}`}
                              style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            >
                              {log.slug}
                            </Link>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>—</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {log.changes && Object.keys(log.changes).length > 0 && (
                            <button
                              onClick={() => handleToggleExpand(log.audit_id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent)',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: 600,
                                padding: 0,
                              }}
                            >
                              {isExpanded ? '▼ Hide' : '▶ Show'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && log.changes && (
                        <tr style={{ background: 'rgba(200, 90, 42, 0.05)' }}>
                          <td colSpan={4} style={{ paddingLeft: 20 }}>
                            <div style={{ paddingBlock: 12 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
                                Changes:
                              </div>
                              <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--muted)' }}>
                                {Object.entries(log.changes).map(([key, value]) => (
                                  <div key={key} style={{ marginBottom: 4 }}>
                                    <span style={{ fontWeight: 600 }}>{key}:</span> {String(value)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Results Summary */}
      {!loading && logs.length > 0 && (
        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--muted)' }}>
          Showing {logs.length} audit log {logs.length === 1 ? 'entry' : 'entries'}
        </div>
      )}

      {/* Navigation Link */}
      <div style={{ marginTop: 24 }}>
        <Link href="/recipes" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Back to recipes
        </Link>
      </div>
    </div>
  );
}
