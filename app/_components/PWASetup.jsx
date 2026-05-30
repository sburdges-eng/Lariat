'use client';
import { useEffect } from 'react';

export default function PWASetup() {
  useEffect(() => {
    if (/\bElectron\//.test(window.navigator.userAgent)) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
    }
  }, []);

  return null; // Component does not render anything to the screen
}
