import { Suspense } from 'react';
import LoginPinForm from './LoginPinForm.jsx';

export default function LoginPinPage() {
  return (
    <div style={{ maxWidth: 400, margin: '48px auto' }}>
      <h1 style={{ marginBottom: 8 }}>Sensitive pages</h1>
      <p className="subtitle" style={{ marginBottom: 24 }}>
        Enter the kitchen manager PIN to open analytics, costing, and related tools. Set <code>LARIAT_PIN</code> on the server to enable this gate.
      </p>
      <Suspense fallback={<div className="card" style={{ color: 'var(--muted)' }}>Loading…</div>}>
        <LoginPinForm />
      </Suspense>
    </div>
  );
}
