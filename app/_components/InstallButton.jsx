'use client';
import Link from 'next/link';
import useInstallPrompt from './useInstallPrompt.js';

export default function InstallButton({ variant = 'sidebar' }) {
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  if (installed) return null;

  const onClick = async () => {
    const outcome = await promptInstall();
    if (outcome === 'unavailable') {
      window.location.href = '/install';
    }
  };

  if (!canInstall) {
    return (
      <Link href="/install" className={`install-btn install-btn--${variant}`}>
        Install Lariat
      </Link>
    );
  }

  return (
    <button type="button" className={`install-btn install-btn--${variant}`} onClick={onClick}>
      Install Lariat
    </button>
  );
}
