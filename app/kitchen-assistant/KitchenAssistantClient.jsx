'use client';

import { useEffect, useRef, useState } from 'react';

const LOC_KEY = 'lariat_location';
const LANG_KEY = 'lariat_language';
export default function KitchenAssistantClient({ locQuery }) {
  const [enabled, setEnabled] = useState(null);
  const [ollamaOk, setOllamaOk] = useState(null);
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('English');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [SpeechRec, setSpeechRec] = useState(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLang = window.localStorage.getItem(LANG_KEY);
      if (savedLang) setLanguage(savedLang);
      
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        setSpeechSupported(true);
        setSpeechRec(() => SR);
      }
    }

    fetch('/api/kitchen-assistant?ping=1')
      .then((r) => r.json())
      .then((d) => {
        setEnabled(!!d.enabled);
        setModel(d.model || '');
        setOllamaOk(d.ollamaReachable);
      })
      .catch(() => {
        setEnabled(false);
        setOllamaOk(false);
      });
  }, []);

  useEffect(() => {
    return () => { recognitionRef.current?.abort(); };
  }, []);

  const toggleListen = (e) => {
    e.preventDefault();
    if (!SpeechRec) return;
    if (isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognitionRef.current = recognition;

      recognition.onstart = () => setIsListening(true);
      recognition.onerror = (evt) => {
        console.error('Speech error:', evt);
        setIsListening(false);
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };
      recognition.onresult = (evt) => {
        const transcript = evt.results[0][0].transcript;
        setMessage(prev => (prev + ' ' + transcript).trim());
      };

      recognition.start();
    } catch (err) {
      console.error("Speech recognition fault:", err);
      setIsListening(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setAnswer('');
    setMeta(null);
    const q = message.trim();
    if (!q) return;
    setLoading(true);
    try {
      const loc = typeof window !== 'undefined' ? window.localStorage.getItem(LOC_KEY) : '';
      const body = { message: q, language };
      if (loc && loc !== 'default') body.location_id = loc;
      const res = await fetch('/api/kitchen-assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Couldn't get an answer. Try again.");
        return;
      }
      setAnswer(data.answer || '');
      setMeta({
        latencyMs: data.latencyMs,
        model: data.model,
        sources: data.sources,
        disclaimer: data.disclaimer,
      });
    } catch (ce) {
      setErr(String(ce.message || ce));
    } finally {
      setLoading(false);
    }
  };

  if (enabled === false) {
    return (
      <div className="card border-yellow">
        <p className="m-0">
          <strong>AI is off.</strong> Tell a manager to start the AI server on the office Mac.
        </p>
      </div>
    );
  }

  return (
    <>
      {enabled && ollamaOk === false && (
        <div className="card mb-16 border-red" role="alert" aria-live="assertive">
          <strong>AI is down.</strong> Can't connect to the server. Ask a manager.
        </div>
      )}

      <form
        onSubmit={submit}
        className="card mb-20"
        aria-busy={loading}
        aria-describedby={err ? 'ka-err' : undefined}
      >
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <label htmlFor="ka-q" className="label" style={{ margin: 0 }}>
            Ask a question
          </label>
          <label htmlFor="ka-lang" className="sr-only">Answer language</label>
          <select
            id="ka-lang"
            name="ka-lang"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              if (typeof window !== 'undefined') window.localStorage.setItem(LANG_KEY, e.target.value);
            }}
            className="input"
            style={{ width: 'auto' }}
            aria-label="Answer language"
          >
            <option value="English">English</option>
            <option value="Spanish">Español</option>
            <option value="French">Français</option>
            <option value="Tagalog">Tagalog</option>
            <option value="Kenyan Swahili">Swahili (Kenya)</option>
          </select>
        </div>
        <textarea
          id="ka-q"
          name="ka-q"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="ex: What's 86? How much aji prep? Dairy in the dressing?"
          className="input mb-12"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={2000}
          aria-required="true"
          aria-invalid={!!err}
          aria-describedby={err ? 'ka-err' : undefined}
        />
        <div className="flex-center-gap" role="group" aria-label="Kitchen assistant controls">
          <button
            type="submit"
            className="btn primary"
            disabled={loading || !message.trim()}
            aria-label={loading ? 'Waiting for answer' : 'Ask kitchen assistant'}
          >
            {loading ? 'Wait...' : 'Ask'}
          </button>
          {speechSupported && (
            <button
              type="button"
              onClick={toggleListen}
              className={`btn ${isListening ? 'red' : ''}`}
              aria-pressed={isListening}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            >
              {isListening ? 'Stop 🛑' : 'Speak 🎤'}
            </button>
          )}
          {model && (
            <span className="meta" aria-label={`Model: ${model}`}>
              Model: <code>{model}</code>
            </span>
          )}
        </div>
        {isListening && (
          <span className="sr-only" role="status" aria-live="polite">Listening for voice input</span>
        )}
      </form>

      {err && (
        <div id="ka-err" className="card border-red mb-16" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      {answer && (
        <div className="card" role="region" aria-labelledby="ka-answer-h" aria-live="polite">
          <h2 className="section-head mb-12" id="ka-answer-h">Answer</h2>
          <div className="assistant-answer">{answer}</div>
          {meta?.latencyMs != null && (
            <p className="meta mt-16" aria-label={`Response time ${meta.latencyMs} milliseconds, model ${meta.model}`}>
              {meta.latencyMs} ms · {meta.model}
            </p>
          )}
          {meta?.sources && meta.sources.length > 0 && (
            <details className="mt-12">
              <summary className="meta cursor-pointer">Books checked</summary>
              <ul className="meta mt-8">
                {meta.sources.map((s) => (
                  <li key={`${s.type}-${s.detail}`}>
                    <strong>{s.type}</strong>: {s.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {meta?.disclaimer && (
            <p className="meta text-yellow border-top mt-16" role="note">
              Check tags with a manager. Do not trust AI for allergies.
            </p>
          )}
        </div>
      )}
    </>
  );
}
