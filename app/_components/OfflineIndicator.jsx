// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useEffect, useState } from 'react';

export default function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);

    const onOnline = () => {
      setOnline(true);
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'replayQueue' });
      }
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const onMsg = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === 'mutationQueued' || d.type === 'mutationReplayed' || d.type === 'queueSizeResult') {
        if (typeof d.size === 'number') setQueued(d.size);
      }
    };
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', onMsg);
      // Ask the SW for current queue size on mount
      const ask = () => navigator.serviceWorker.controller?.postMessage({ type: 'queueSize' });
      if (navigator.serviceWorker.controller) ask();
      else navigator.serviceWorker.ready.then(ask).catch(() => {});
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', onMsg);
    };
  }, []);

  if (online && queued === 0) return null;

  const label = online
    ? `Sending ${queued} saved items…`
    : queued > 0
      ? `No connection — ${queued} saved here, will send when it's back`
      : 'No connection';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: '8px 0',
        padding: '6px 10px',
        borderRadius: 6,
        fontSize: 12,
        background: online ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.18)',
        color: online ? 'var(--yellow, #f59e0b)' : 'var(--red, #ef4444)',
        border: `1px solid ${online ? 'var(--yellow, #f59e0b)' : 'var(--red, #ef4444)'}`,
      }}
    >
      {label}
    </div>
  );
}
