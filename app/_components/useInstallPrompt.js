// @ts-check
'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * The PWA install-prompt event fired by Chromium-based browsers. Not part
 * of TypeScript's lib.dom.d.ts, so it is typed locally against the spec
 * shape (https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent).
 * @typedef {Event & {
 *   readonly platforms: string[];
 *   readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed', platform: string }>;
 *   prompt(): Promise<void>;
 * }} BeforeInstallPromptEvent
 */

export default function useInstallPrompt() {
  const [deferred, setDeferred] = useState(
    /** @type {BeforeInstallPromptEvent | null} */ (null),
  );
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = () => {
      const isStandalone =
        mql.matches || /** @type {{ standalone?: boolean }} */ (window.navigator).standalone === true;
      setStandalone(isStandalone);
    };
    syncStandalone();
    mql.addEventListener?.('change', syncStandalone);

    /** @param {Event} e */
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(/** @type {BeforeInstallPromptEvent} */ (e));
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
