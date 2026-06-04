'use client';
import { useEffect, useState } from 'react';
import useInstallPrompt from '../_components/useInstallPrompt.js';
import { isDesktopUserAgent, lanInstallUrl } from './installUrl.js';

function detectBrowser() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'chrome';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Safari\//.test(ua) && !/Chrome|CriOS/.test(ua)) return 'safari';
  return 'unknown';
}

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua)) return 'mac';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  return 'unknown';
}

export default function InstallPage() {
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [mounted, setMounted] = useState(false);
  const [desktopApp, setDesktopApp] = useState(false);
  const [browser, setBrowser] = useState('unknown');
  const [platform, setPlatform] = useState('unknown');
  const [lanUrl, setLanUrl] = useState('');
  const [discoveryWarning, setDiscoveryWarning] = useState('');

  useEffect(() => {
    setMounted(true);
    setDesktopApp(isDesktopUserAgent(window.navigator.userAgent));
    setBrowser(detectBrowser());
    setPlatform(detectPlatform());
    setLanUrl(lanInstallUrl(window.location));

    fetch('/api/health')
      .then((res) => res.json())
      .then((body) => {
        const mdns = body?.probes?.mdns;
        if (mdns && mdns.ok === false) {
          setDiscoveryWarning(mdns.error || 'mDNS discovery is not advertising this Mac.');
        }
      })
      .catch(() => {
        /* Connect page still works with the direct URL below. */
      });
  }, []);

  return (
    <div className="install-page">
      <h1>Connect Lariat</h1>
      <p className="install-lede">
        Add another device, or install the browser app when you are not in the Mac app.
      </p>

      {mounted && desktopApp && (
        <div className="install-section">
          <h2>Mac app</h2>
          <p>You&apos;re already using the Mac app. No browser install needed.</p>
        </div>
      )}

      {!desktopApp && installed && (
        <div className="install-section">
          <h2>Already installed</h2>
          <p>You&apos;re running Lariat as an installed app. Nothing more to do.</p>
        </div>
      )}

      {mounted && !desktopApp && !installed && (
        <div className="install-section">
          <h2>One-click install</h2>
          {canInstall ? (
            <>
              <p>Your browser is ready — click to install:</p>
              <button
                type="button"
                className="install-btn install-btn--page"
                onClick={() => promptInstall()}
              >
                Install Lariat
              </button>
            </>
          ) : (
            <p>Use the steps below for this browser.</p>
          )}
        </div>
      )}

      {!desktopApp && platform === 'mac' && (browser === 'chrome' || browser === 'edge') && (
        <div className="install-section">
          <h2>Mac — Chrome / Edge</h2>
          <ol>
            <li>Click the install icon in the URL bar (looks like a small screen with a down arrow)</li>
            <li>Or: <code>⋮</code> menu → <strong>Cast, save and share</strong> → <strong>Install Lariat Cockpit…</strong></li>
            <li>Confirm. Lariat appears in <code>/Applications</code> and your Dock.</li>
          </ol>
        </div>
      )}

      {!desktopApp && platform === 'mac' && browser === 'safari' && (
        <div className="install-section">
          <h2>Mac — Safari 17+</h2>
          <ol>
            <li><strong>File</strong> menu → <strong>Add to Dock…</strong></li>
            <li>Confirm the name and icon, then click <strong>Add</strong>.</li>
            <li>Lariat appears in your Dock and <code>/Applications</code>.</li>
          </ol>
        </div>
      )}

      {!desktopApp && platform === 'ios' && (
        <div className="install-section">
          <h2>iPad / iPhone — Safari</h2>
          <ol>
            <li>Tap the <strong>Share</strong> icon (square with up arrow).</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Confirm. Lariat shows up as an app icon on your home screen.</li>
          </ol>
        </div>
      )}

      <div className="install-section">
        <h2>Other devices on the network</h2>
        <p>
          From another Mac or iPad on the same Wi-Fi, open this address:
        </p>
        <p>
          <code>{lanUrl || 'http://lariat.local:3001'}</code>
        </p>
        {discoveryWarning && (
          <p role="status">
            <strong>Discovery warning:</strong> mDNS is not advertising cleanly. Other devices can still use the address above. {discoveryWarning}
          </p>
        )}
      </div>
    </div>
  );
}
