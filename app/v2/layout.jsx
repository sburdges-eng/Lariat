// @ts-nocheck - v2 preview shell contract is covered by tests/js/test-v2-shell.mjs.
import Link from 'next/link';
import { cookies } from 'next/headers';
import LocalePicker from '../_components/LocalePicker.jsx';
import { LOCALE_COOKIE, getMessages, normalizeLocale, t } from '../../lib/i18n/index.ts';

export const dynamic = 'force-dynamic';

export const V2_PREVIEW_COOKIE = 'lariat_v2';

function V2ChromeReset() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          .strip, .sidebar, .command, .cmdk-scrim, .skip-link, footer.command { display: none !important; }
          #main-content { width: 100% !important; max-width: none !important; padding: 0 !important; }
          .main { padding: 0 !important; max-width: none !important; }
          .app { display: block !important; min-height: 100dvh !important; height: auto !important; }
          body { background: #171814 !important; }
          .v2-shell {
            min-height: 100dvh;
            background:
              linear-gradient(140deg, rgba(39, 77, 65, 0.58), transparent 36%),
              linear-gradient(320deg, rgba(191, 88, 45, 0.32), transparent 40%),
              #171814;
            color: #f6f0e5;
            font-family: var(--sans, "Inter Tight", system-ui, sans-serif);
          }
          .v2-shell a { color: inherit; }
          .v2-frame {
            width: min(1180px, calc(100vw - 32px));
            margin: 0 auto;
            padding: 28px 0 52px;
          }
          .v2-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            min-height: 44px;
            margin-bottom: 28px;
            color: rgba(246, 240, 229, 0.74);
            font-size: 13px;
          }
          .v2-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            color: #f6f0e5;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .v2-mark {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #d86f42;
            box-shadow: 0 0 0 5px rgba(216, 111, 66, 0.16);
            flex: 0 0 auto;
          }
          .v2-return {
            border: 1px solid rgba(246, 240, 229, 0.22);
            border-radius: 6px;
            padding: 9px 12px;
            text-decoration: none;
            white-space: nowrap;
          }
          .v2-return:hover { border-color: rgba(246, 240, 229, 0.44); background: rgba(246, 240, 229, 0.08); }
          .v2-gate {
            display: grid;
            place-items: center;
            padding: 24px;
          }
          .v2-gate-panel {
            width: min(460px, 100%);
            border: 1px solid rgba(246, 240, 229, 0.18);
            border-radius: 8px;
            background: rgba(246, 240, 229, 0.08);
            padding: 28px;
          }
          .v2-gate-panel h1 {
            margin: 0 0 10px;
            font-size: clamp(28px, 5vw, 46px);
            line-height: 1;
            letter-spacing: 0;
          }
          .v2-gate-panel p {
            margin: 0 0 22px;
            color: rgba(246, 240, 229, 0.7);
            line-height: 1.45;
          }
          @media (max-width: 720px) {
            .v2-frame { width: min(100% - 24px, 1180px); padding-top: 18px; }
            .v2-topbar { align-items: flex-start; flex-direction: column; }
          }
        `,
      }}
    />
  );
}

function V2Topbar({ locale, m }) {
  return (
    <header className="v2-topbar">
      <div className="v2-brand">
        <span className="v2-mark" aria-hidden />
        <span>{t(m, 'shell.brand')}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <LocalePicker current={locale} label={t(m, 'shell.localeLabel')} />
        <Link className="v2-return" href="/">
          {t(m, 'shell.returnV1')}
        </Link>
      </div>
    </header>
  );
}

function V2Gate({ m }) {
  return (
    <section className="v2-shell v2-gate" data-v2-shell>
      <div className="v2-gate-panel">
        <h1>{t(m, 'shell.gateTitle')}</h1>
        <p>{t(m, 'shell.gateBody')}</p>
        <Link className="v2-return" href="/">
          {t(m, 'shell.returnV1')}
        </Link>
      </div>
    </section>
  );
}

export default async function V2Layout({ children }) {
  const cookieStore = await cookies();
  const previewCookie = cookieStore.get(V2_PREVIEW_COOKIE);
  const enabled = previewCookie?.value === '1';
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  return (
    <>
      <V2ChromeReset />
      {enabled ? (
        <section className="v2-shell" data-v2-shell>
          <div className="v2-frame">
            <V2Topbar locale={locale} m={m} />
            {children}
          </div>
        </section>
      ) : (
        <V2Gate m={m} />
      )}
    </>
  );
}
