'use client';

import { useState, useMemo } from 'react';

const MAX_MESSAGE = 2000;

export default function SpecialsPage() {
  const [pantry, setPantry] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [answer, setAnswer] = useState('');
  const [model, setModel] = useState('');
  const [recipeScratch, setRecipeScratch] = useState('');

  const combinedPrompt = useMemo(() => {
    return pantry.trim()
      ? `AVAILABLE INGREDIENTS/OVERSTOCK:\n${pantry.trim()}\n\nCHEF PROMPT:\n${prompt.trim()}`
      : prompt.trim();
  }, [pantry, prompt]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setAnswer('');

    if (!prompt.trim() && !pantry.trim()) return;
    if (combinedPrompt.length > MAX_MESSAGE) {
      setErr('Prompt + pantry too long — trim to under 2000 chars');
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
        setErr(data.error || "Couldn't save. Try again.");
        return;
      }
      setAnswer(data.answer || '');
      setModel(data.model || '');
    } catch (ce) {
      setErr(String(ce.message || ce));
    } finally {
      setLoading(false);
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
              <button type="submit" className="btn primary" disabled={loading || (!prompt.trim() && !pantry.trim()) || combinedPrompt.length > MAX_MESSAGE}>
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
