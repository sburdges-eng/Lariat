import { Suspense } from 'react';
import LoginPinForm from './LoginPinForm.jsx';

export default function LoginPinPage() {
  return (
    <div style={{ maxWidth: 400, margin: '48px auto' }}>
      <h1 style={{ marginBottom: 8 }}>Sensitive pages</h1>
      <p className="subtitle" style={{ marginBottom: 24 }}>
        Enter the kitchen manager PIN to open sales numbers, costs, and the rest of the back-office pages.
      </p>
      <Suspense fallback={<div className="card" style={{ color: 'var(--muted)' }}>Loading…</div>}>
        <LoginPinForm />
      </Suspense>
    </div>
  );
}
