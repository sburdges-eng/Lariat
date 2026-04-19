import { Suspense } from 'react';
import '../styles/globals.css';
import Sidebar from './_components/Sidebar.jsx';
import PWASetup from './_components/PWASetup.jsx';

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
  themeColor: '#f59e0b',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PWASetup />
        <div className="app">
          <Suspense fallback={<aside className="sidebar" aria-hidden style={{ minWidth: 240 }} />}>
            <Sidebar />
          </Suspense>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
