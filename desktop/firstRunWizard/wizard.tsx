import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Settings } from '../settings';

declare global {
  interface Window {
    lariat: {
      getSettings: () => Promise<Settings | null>;
      pickDirectory: (_defaultPath?: string) => Promise<string | null>;
      getDataDirDefault: () => Promise<string>;
      detectExistingDb: () => Promise<string | null>;
      proceed: (_settings: Settings) => Promise<void>;
      cancel: () => Promise<void>;
    };
  }
}

interface PathFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (_next: string) => void;
  onPick: () => void;
  required?: boolean;
}

interface TextFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (_next: string) => void;
  type?: 'text' | 'password';
  required?: boolean;
}

function TextField(props: TextFieldProps): JSX.Element {
  return (
    <div className="field">
      <label>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <input
        type={props.type || 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        inputMode={props.type === 'password' ? 'numeric' : undefined}
      />
      {props.hint ? <div className="hint">{props.hint}</div> : null}
    </div>
  );
}

function PathField(props: PathFieldProps): JSX.Element {
  return (
    <div className="field">
      <label>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <div className="field-row">
        <input
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button type="button" onClick={props.onPick}>
          Choose…
        </button>
      </div>
      {props.hint ? <div className="hint">{props.hint}</div> : null}
    </div>
  );
}

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes);
  window.crypto.getRandomValues(data);
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
}

function App(): JSX.Element {
  const [dataDir, setDataDir] = useState<string>('');
  const [datapackDir, setDatapackDir] = useState<string>('');
  const [pythonPath, setPythonPath] = useState<string>('');
  const [managerPin, setManagerPin] = useState<string>('');
  const [managerPinSecret, setManagerPinSecret] = useState<string>('');
  const [existingDb, setExistingDb] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await window.lariat.getSettings();
        const def = await window.lariat.getDataDirDefault();
        if (!cancelled) {
          setDataDir(saved?.dataDir || def);
          setDatapackDir(saved?.datapackDir || '');
          setPythonPath(saved?.pythonPath || '');
          setManagerPin(saved?.managerPin || '');
          setManagerPinSecret(saved?.managerPinSecret || randomHex(32));
        }
        const existing = await window.lariat.detectExistingDb();
        if (!cancelled) setExistingDb(existing);
      } catch (e) {
        if (!cancelled) setError(`Failed to load defaults: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Normalize trailing slashes so `/Users/foo/data` and `/Users/foo/data/`
  // don't trigger a false-positive banner. The renderer can't use Node's
  // `path` module without a polyfill, and trailing-slash differences are the
  // common case worth defending against.
  const norm = (p: string): string => p.replace(/\/+$/, '');
  const showExistingBanner =
    existingDb !== null && norm(existingDb) !== norm(dataDir);

  const onPick = async (
    setter: (_v: string) => void,
    current: string,
  ): Promise<void> => {
    const picked = await window.lariat.pickDirectory(current || undefined);
    if (picked) setter(picked);
  };

  const onUseExisting = (): void => {
    if (existingDb) setDataDir(existingDb);
  };

  const onCancel = (): void => {
    void window.lariat.cancel();
  };

  const onFinish = async (): Promise<void> => {
    setError('');
    if (!dataDir.trim()) {
      setError('Data directory is required.');
      return;
    }
    const cleanPin = managerPin.trim();
    if (!/^[0-9]{4,6}$/.test(cleanPin)) {
      setError('Manager PIN must be 4-6 digits.');
      return;
    }
    const settings: Settings = {
      dataDir: dataDir.trim(),
      port: 3000,
      managerPin: cleanPin,
      managerPinSecret: managerPinSecret || randomHex(32),
    };
    if (datapackDir.trim()) settings.datapackDir = datapackDir.trim();
    if (pythonPath.trim()) settings.pythonPath = pythonPath.trim();
    setBusy(true);
    try {
      await window.lariat.proceed(settings);
    } catch (e) {
      setBusy(false);
      setError(`Failed to save settings: ${(e as Error).message}`);
    }
  };

  return (
    <div className="wizard">
      <h1>Welcome to Lariat</h1>
      <p className="lead">
        Pick where Lariat should store its data. You can change these later in
        the settings file.
      </p>

      {showExistingBanner ? (
        <div className="banner">
          <div className="banner-title">Existing Lariat data found</div>
          <div>
            We detected an existing database at <code>{existingDb}</code>. Use
            it in place to pick up where you left off.
          </div>
          <div className="banner-actions">
            <button type="button" onClick={onUseExisting}>
              Use it in place
            </button>
          </div>
        </div>
      ) : null}

      <PathField
        label="Data directory"
        hint="Stores lariat.db, backups, exports, and audit logs."
        value={dataDir}
        onChange={setDataDir}
        onPick={() => onPick(setDataDir, dataDir)}
        required
      />

      <TextField
        label="Manager PIN"
        hint="4-6 digits. Opens back office."
        value={managerPin}
        onChange={setManagerPin}
        type="password"
        required
      />

      <PathField
        label="Data Pack directory (optional)"
        hint="External knowledge base (USDA, FDA Food Code, etc). Leave blank to disable grounded search."
        value={datapackDir}
        onChange={setDatapackDir}
        onPick={() => onPick(setDatapackDir, datapackDir)}
      />

      <PathField
        label="Python venv directory (optional)"
        hint="Used by ingest scripts. Leave blank to use the system python3."
        value={pythonPath}
        onChange={setPythonPath}
        onPick={() => onPick(setPythonPath, pythonPath)}
      />

      {error ? <div className="error">{error}</div> : null}

      <div className="actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={onFinish}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Finish'}
        </button>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('wizard: #root element missing');
createRoot(rootEl).render(<App />);
