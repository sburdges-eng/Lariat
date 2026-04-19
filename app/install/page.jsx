'use client';
import { useEffect, useState } from 'react';
import useInstallPrompt from '../_components/useInstallPrompt.js';

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
  const [browser, setBrowser] = useState('unknown');
  const [platform, setPlatform] = useState('unknown');
  const [lanUrl, setLanUrl] = useState('');

  useEffect(() => {
    setBrowser(detectBrowser());
    setPlatform(detectPlatform());
    const host = window.location.host;
    setLanUrl(`http://${host}`);
  }, []);

  return (
    <div className="install-page">
      <h1>Install Lariat</h1>
      <p className="install-lede">
        One-click install — puts Lariat in your Applications folder (Mac) or Home Screen (iPad),
        runs in its own window, launches straight from the Dock.
      </p>

      {installed && (
        <div className="install-section">
          <h2>Already installed</h2>
          <p>You&apos;re running Lariat as an installed app. Nothing more to do.</p>
        </div>
      )}

      {!installed && (
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
                Install Lariat Cockpit
              </button>
            </>
          ) : (
            <p>
              Your browser didn&apos;t offer a one-click prompt. Follow the steps below for your
              browser.
            </p>
          )}
        </div>
      )}

      {platform === 'mac' && (browser === 'chrome' || browser === 'edge') && (
        <div className="install-section">
          <h2>Mac — Chrome / Edge</h2>
          <ol>
            <li>Click the install icon in the URL bar (looks like a small screen with a down arrow)</li>
            <li>Or: <code>⋮</code> menu → <strong>Cast, save and share</strong> → <strong>Install Lariat Cockpit…</strong></li>
            <li>Confirm. Lariat appears in <code>/Applications</code> and your Dock.</li>
          </ol>
        </div>
      )}

      {platform === 'mac' && browser === 'safari' && (
        <div className="install-section">
          <h2>Mac — Safari 17+</h2>
          <ol>
            <li><strong>File</strong> menu → <strong>Add to Dock…</strong></li>
            <li>Confirm the name and icon, then click <strong>Add</strong>.</li>
            <li>Lariat appears in your Dock and <code>/Applications</code>.</li>
          </ol>
        </div>
      )}

      {platform === 'ios' && (
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
          From any other Mac or iPad on the same Wi-Fi, open this URL in the browser and follow
          the steps above:
        </p>
        <p>
          <code>{lanUrl || 'http://<this-mac>:3000'}</code>
        </p>
      </div>
    </div>
  );
}
