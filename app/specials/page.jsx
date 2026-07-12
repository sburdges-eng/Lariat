// @ts-check
'use client';

import { useEffect, useState, useMemo } from 'react';

/** @typedef {import('../../lib/computeEngine/sandboxCosting.ts').SandboxCostLine} SandboxCostLine */
/** @typedef {import('../../lib/kitchenAssistantContext.ts').ContextSource} ContextSource */

import { MAX_MESSAGE, AI_DOWN_COPY } from '../../lib/specialsShared';

/**
 * @param {number} status
 * @param {unknown} error
 * @returns {string}
 */
function specialsErrorCopy(status, error) {
  const raw = String(error || '');
  if (status === 502 || /fetch failed|failed to fetch|ECONNREFUSED|Ollama/i.test(raw)) {
    return AI_DOWN_COPY;
  }
  return raw || "Couldn't generate. Try again.";
}

export default function SpecialsPage() {
  const [ollamaOk, setOllamaOk] = useState(/** @type {boolean | null} */ (null));
  const [pantry, setPantry] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [answer, setAnswer] = useState('');
  const [model, setModel] = useState('');
  const [recipeScratch, setRecipeScratch] = useState('');
  const [costBreakdown, setCostBreakdown] = useState(/** @type {SandboxCostLine[] | null} */ (null));
  const [costTotal, setCostTotal] = useState(/** @type {number | null} */ (null));
  const [sources, setSources] = useState(/** @type {ContextSource[] | null} */ (null));

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [savedId, setSavedId] = useState('');

  useEffect(() => {
    fetch('/api/specials?ping=1')
      .then((r) => r.json())
      .then((d) => {
        setModel(d.model || '');
        const reachable = d.ollamaReachable !== false;
        setOllamaOk(reachable);
        if (!reachable) setErr(AI_DOWN_COPY);
      })
      .catch(() => {
        setOllamaOk(false);
        setErr(AI_DOWN_COPY);
      });
  }, []);

  const combinedPrompt = useMemo(() => {
    return pantry.trim()
      ? `AVAILABLE INGREDIENTS/OVERSTOCK:\n${pantry.trim()}\n\nCHEF PROMPT:\n${prompt.trim()}`
      : prompt.trim();
  }, [pantry, prompt]);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setAnswer('');
    setShowSaveForm(false);
    setSavedId('');

    if (!prompt.trim() && !pantry.trim()) return;
    if (combinedPrompt.length > MAX_MESSAGE) {
      setErr('Prompt + pantry too long — trim to under 2000 chars');
      return;
    }
    if (ollamaOk === false) {
      setErr(AI_DOWN_COPY);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/specials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: combinedPrompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(specialsErrorCopy(res.status, data.error));
        return;
      }
      setAnswer(data.answer || '');
      setModel(data.model || '');
      setCostBreakdown(data.cost_breakdown ?? null);
      setCostTotal(data.cost_total ?? null);
      setSources(data.sources ?? null);
    } catch (ce) {
      setErr(specialsErrorCopy(0, /** @type {{ message?: unknown }} */ (ce)?.message || ce));
    } finally {
      setLoading(false);
    }
  };

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const submitSave = async (e) => {
    e.preventDefault();
    setSaveErr('');
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/specials/saved', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          pantry_text: pantry,
          prompt_text: prompt,
          ai_answer: answer,
          ai_model: model,
          cost_breakdown: costBreakdown,
          cost_total: costTotal,
          scratch_notes: recipeScratch,
          sources: sources,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const pinRedirect = res.redirected && res.url.includes('/login-pin');
      if (!res.ok || pinRedirect) {
        if (res.status === 401 || pinRedirect) setSaveErr('Manager PIN required to save.');
        else setSaveErr(data.error || 'Save failed.');
        return;
      }
      setSavedId(data.id);
      setShowSaveForm(false);
      setSaveName('');
    } catch (ce) {
      setSaveErr(String(/** @type {{ message?: unknown }} */ (ce).message || ce));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1>Specials</h1>
      <p className="subtitle">Use up overstock, price out a dish, or riff on new ideas.</p>

      <div className="grid-2">
        <div>
          <form onSubmit={submit} className="card">
            <label className="label mb-12">What you&apos;ve got to use up</label>
            <textarea
              value={pantry}
              onChange={(e) => setPantry(e.target.value)}
              rows={2}
              placeholder="e.g. 10 lbs pork belly, extra cilantro, half case of slightly soft tomatoes"
              className="input mb-16"
            />

            <label className="label mb-12">What are you thinking?</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. Create a high-margin pork belly appetizer using these tomatoes. Provide a rough costing framework."
              className="input mb-12"
            />
            <div className={`meta mb-12${combinedPrompt.length >= MAX_MESSAGE ? ' text-red' : ''}`} role="status" aria-live="polite">
              {combinedPrompt.length} / {MAX_MESSAGE}
            </div>
            <div className="flex-center-gap">
              <button type="submit" className="btn primary" disabled={loading || ollamaOk === false || (!prompt.trim() && !pantry.trim()) || combinedPrompt.length > MAX_MESSAGE}>
                {loading ? 'Thinking...' : 'Run it'}
              </button>
              {model && (
                <span className="meta">
                  Model: <code>{model}</code>
                </span>
              )}
            </div>
          </form>

          {err && (
            <div className="card">
              <span style={{ color: 'var(--red)' }}>{err}</span>
            </div>
          )}

          {answer && (
            <div className="card">
              <h2 className="section-head mb-12">Here&apos;s what I&apos;ve got</h2>
              <div className="assistant-answer" style={{ whiteSpace: 'pre-wrap' }}>{answer}</div>

              {savedId && (
                <p className="meta mb-12" style={{ marginTop: 16 }}>
                  Saved → <a href={`/specials/saved/${savedId}`}>view this special</a>
                </p>
              )}

              {!savedId && !showSaveForm && (
                <button type="button" className="btn" style={{ marginTop: 16 }} onClick={() => setShowSaveForm(true)}>
                  Save this special
                </button>
              )}

              {showSaveForm && (
                <form onSubmit={submitSave} style={{ marginTop: 16 }}>
                  <label className="label mb-12">Name this special</label>
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Name this special"
                    className="input mb-12"
                    maxLength={200}
                  />
                  <div className="flex-center-gap">
                    <button type="submit" className="btn primary" disabled={saving || !saveName.trim()}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" className="btn" onClick={() => { setShowSaveForm(false); setSaveErr(''); }}>
                      Cancel
                    </button>
                  </div>
                  {saveErr && <p className="meta mb-12" style={{ color: 'var(--red)', marginTop: 8 }}>{saveErr}</p>}
                </form>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="section-head mb-12">Your notes</h2>
          <p className="meta mb-12">Work out the numbers, adjust portions, clean it up before you pitch it.</p>
          <textarea
            value={recipeScratch}
            onChange={(e) => setRecipeScratch(e.target.value)}
            className="input"
            style={{ minHeight: '500px', fontFamily: 'monospace' }}
            placeholder="Start writing..."
          />
        </div>
      </div>
    </div>
  );
}
