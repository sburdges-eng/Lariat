// @ts-check
'use client';

import { useRouter } from 'next/navigation';

// EN/ES toggle for the v2 topbar. Writes the server-readable
// `lariat_locale` cookie (the i18n source of truth) AND keeps the
// kitchen-assistant's `lariat_language` localStorage key in sync so the
// LLM answers in the same language the chrome shows. router.refresh()
// re-renders the server components in the new locale immediately — no
// page reload on the iPad.

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** lariat_locale → kitchen-assistant picker label.
 *  @type {Record<string, string>} */
const LANGUAGE_LABELS = { en: 'English', es: 'Spanish' };

/**
 * @param {{ current: 'en' | 'es', label?: string }} props
 */
export default function LocalePicker({ current, label }) {
  const router = useRouter();

  /** @param {'en' | 'es'} locale */
  const setLocale = (locale) => {
    if (locale === current) return;
    document.cookie = `lariat_locale=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    try {
      window.localStorage.setItem('lariat_language', LANGUAGE_LABELS[locale] || 'English');
    } catch {
      /* storage may be unavailable; the cookie alone is enough */
    }
    router.refresh();
  };

  const locales = /** @type {Array<'en' | 'es'>} */ (['en', 'es']);
  return (
    <div role="group" aria-label={label || 'Language'} style={groupStyle}>
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => setLocale(locale)}
          aria-pressed={current === locale}
          style={{
            ...buttonStyle,
            ...(current === locale ? activeStyle : null),
          }}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

const groupStyle = {
  display: 'inline-flex',
  gap: 4,
};

const buttonStyle = {
  border: '1px solid rgba(246, 240, 229, 0.22)',
  borderRadius: 6,
  padding: '7px 10px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  cursor: 'pointer',
};

const activeStyle = {
  background: 'rgba(246, 240, 229, 0.16)',
  borderColor: 'rgba(246, 240, 229, 0.44)',
};
