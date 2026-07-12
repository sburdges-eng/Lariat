// @ts-check
'use client';

import { useEffect, useState } from 'react';

/** @typedef {import('../../../lib/managerPins.ts').ManagerPinUser} ManagerPinUser */
/** @typedef {import('../../../lib/managerPins.ts').ManagerPinRole} ManagerPinRole */

/**
 * @typedef {Object} EditState
 * @property {number} id
 * @property {string} name
 * @property {ManagerPinRole} role
 * @property {string} pin
 * @property {boolean} is_active
 */

const ROLES = /** @type {{value: ManagerPinRole, label: string}[]} */ ([
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Owner' },
]);

/**
 * @param {ManagerPinUser} user
 * @returns {EditState}
 */
function blankEdit(user) {
  return {
    id: user.id,
    name: user.name || '',
    role: user.role || 'manager',
    pin: '',
    is_active: Boolean(user.is_active),
  };
}

/**
 * @param {ManagerPinUser} user
 * @returns {string}
 */
function statusText(user) {
  return user.is_active ? 'Active' : 'Off';
}

export default function ManagerPinsPage() {
  const [users, setUsers] = useState(/** @type {ManagerPinUser[]} */ ([]));
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState(/** @type {ManagerPinRole} */ ('manager'));
  const [editing, setEditing] = useState(/** @type {EditState | null} */ (null));

  const load = async () => {
    setErr('');
    try {
      const res = await fetch('/api/auth/manager-pins');
      if (!res.ok) {
        setErr('Could not load PINs');
        setLoaded(true);
        return;
      }
      const body = await res.json();
      setUsers(Array.isArray(body.users) ? body.users : []);
      setLoaded(true);
    } catch {
      setErr('Lost connection');
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addPin = async () => {
    setErr('');
    const cleanName = name.trim();
    const cleanPin = pin.trim();
    if (!cleanName) {
      setErr('Add a name');
      return;
    }
    if (!cleanPin) {
      setErr('Add a PIN');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/manager-pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: cleanName, pin: cleanPin, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error || 'Did not save');
        return;
      }
      setName('');
      setPin('');
      setRole('manager');
      await load();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setErr('');
    const cleanName = editing.name.trim();
    const cleanPin = editing.pin.trim();
    if (!cleanName) {
      setErr('Add a name');
      return;
    }

    const payload = /** @type {{id: number, name: string, role: ManagerPinRole, is_active: boolean, pin?: string}} */ ({
      id: editing.id,
      name: cleanName,
      role: editing.role,
      is_active: Boolean(editing.is_active),
    });
    if (cleanPin) payload.pin = cleanPin;

    setBusy(true);
    try {
      const res = await fetch('/api/auth/manager-pins', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error || 'Did not save');
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setBusy(false);
    }
  };

  /** @param {ManagerPinUser} user */
  const turnOff = async (user) => {
    setErr('');
    if (!window.confirm(`Turn off ${user.name}'s PIN?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/manager-pins', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: user.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error || 'Did not turn it off');
        return;
      }
      if (editing?.id === user.id) setEditing(null);
      await load();
    } catch {
      setErr('Lost connection — still active');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-page" data-testid="manager-pins-page">
      <div className="mp-head">
        <div>
          <h1>Manager PINs</h1>
          <p className="subtitle">Keep the house override. Add named PINs here.</p>
        </div>
      </div>

      {err && <div className="mp-error" role="alert">{err}</div>}

      <section className="mp-add">
        <h2>Add PIN</h2>
        <div className="mp-form">
          <label>
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={/** @param {React.ChangeEvent<HTMLInputElement>} e */ (e) => setName(e.target.value)}
              aria-label="Name"
              placeholder="Lunch lead"
            />
          </label>
          <label>
            <span>PIN</span>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={/** @param {React.ChangeEvent<HTMLInputElement>} e */ (e) => setPin(e.target.value)}
              aria-label="PIN"
              placeholder="4 digits"
            />
          </label>
          <label>
            <span>Role</span>
            <select
              value={role}
              onChange={/** @param {React.ChangeEvent<HTMLSelectElement>} e */ (e) =>
                setRole(/** @type {ManagerPinRole} */ (e.target.value))
              }
              aria-label="Role"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn primary" onClick={addPin} disabled={busy}>
            Add PIN
          </button>
        </div>
      </section>

      <section className="mp-list">
        <h2>People with PINs</h2>
        {loaded && users.length === 0 && <p className="mp-empty">None yet.</p>}
        <ul>
          {users.map((user) => {
            const isEditing = editing?.id === user.id;
            return (
              <li key={user.id} className={user.is_active ? 'mp-row' : 'mp-row off'}>
                {isEditing && editing ? (
                  <div className="mp-edit">
                    <label>
                      <span>Name</span>
                      <input
                        type="text"
                        value={editing.name}
                        onChange={/** @param {React.ChangeEvent<HTMLInputElement>} e */ (e) =>
                          setEditing({ ...editing, name: e.target.value })
                        }
                        aria-label="Edit name"
                      />
                    </label>
                    <label>
                      <span>New PIN</span>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={editing.pin}
                        onChange={/** @param {React.ChangeEvent<HTMLInputElement>} e */ (e) =>
                          setEditing({ ...editing, pin: e.target.value })
                        }
                        aria-label="New PIN"
                        placeholder="leave blank"
                      />
                    </label>
                    <label>
                      <span>Role</span>
                      <select
                        value={editing.role}
                        onChange={/** @param {React.ChangeEvent<HTMLSelectElement>} e */ (e) =>
                          setEditing({ ...editing, role: /** @type {ManagerPinRole} */ (e.target.value) })
                        }
                        aria-label="Edit role"
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="mp-check">
                      <input
                        type="checkbox"
                        checked={editing.is_active}
                        onChange={/** @param {React.ChangeEvent<HTMLInputElement>} e */ (e) =>
                          setEditing({ ...editing, is_active: e.target.checked })
                        }
                      />
                      Active
                    </label>
                    <div className="mp-actions">
                      <button type="button" className="btn primary" onClick={saveEdit} disabled={busy}>
                        Save
                      </button>
                      <button type="button" className="btn ghost" onClick={() => setEditing(null)} disabled={busy}>
                        Go back
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mp-person">
                      <strong>{user.name}</strong>
                      <span>{user.role === 'owner' ? 'Owner' : 'Manager'}</span>
                    </div>
                    <span className="mp-status">{statusText(user)}</span>
                    <span className="mp-updated">{user.updated_at || 'not saved yet'}</span>
                    <div className="mp-actions">
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setEditing(blankEdit(user))}
                        aria-label={`Edit ${user.name}`}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      {user.is_active && (
                        <button
                          type="button"
                          className="btn red"
                          onClick={() => turnOff(user)}
                          aria-label={`Turn off ${user.name}`}
                          disabled={busy}
                        >
                          Turn off
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
