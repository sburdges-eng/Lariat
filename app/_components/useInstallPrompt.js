// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useCallback, useEffect, useState } from 'react';

export default function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = () => {
      const isStandalone = mql.matches || window.navigator.standalone === true;
      setStandalone(isStandalone);
    };
    syncStandalone();
    mql.addEventListener?.('change', syncStandalone);

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mql.removeEventListener?.('change', syncStandalone);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable';
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice?.outcome || 'dismissed';
  }, [deferred]);

  return {
    canInstall: !!deferred && !installed && !standalone,
    installed: installed || standalone,
    standalone,
    promptInstall,
  };
}
