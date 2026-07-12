// @ts-check
import { Suspense } from 'react';
import '../styles/globals.css';
import Sidebar from './_components/Sidebar.jsx';
import PWASetup from './_components/PWASetup.jsx';
import ServiceStrip from './_components/ServiceStrip.jsx';
import CommandBar from './_components/CommandBar.jsx';
import CommandPalette from './_components/CommandPalette.jsx';
import UxPolishMount from './_components/UxPolishMount.jsx';
import FloorplanMount from './_components/FloorplanMount.jsx';

export const metadata = {
  title: 'Lariat Cockpit',
  description: 'Kitchen ops, recipes, and line checks for The Lariat',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Lariat Cockpit',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#c85a2a',
};

/** @param {{ children: import('react').ReactNode }} props */
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <UxPolishMount />
        <PWASetup />
        <div className="app">
          <Suspense fallback={<header className="strip" aria-hidden />}>
            <ServiceStrip />
          </Suspense>
          <Suspense fallback={<aside className="sidebar" aria-hidden style={{ minWidth: 240 }} />}>
            <Sidebar />
          </Suspense>
          <main id="main-content" className="main" tabIndex={-1}>{children}</main>
          <Suspense fallback={<footer className="command" aria-hidden />}>
            <CommandBar />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        <Suspense fallback={null}>
          <FloorplanMount />
        </Suspense>
      </body>
    </html>
  );
}
