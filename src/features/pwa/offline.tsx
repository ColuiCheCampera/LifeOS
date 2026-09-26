import { WorkApp, WorkOverlays } from '@/features/work/ui';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import {
  LocalProvider,
  SessionBoundary,
  SyncPanel,
  useLocalSettings,
  useLocalWrite,
} from '@/features/sync/provider';
import { PwaControls } from './ui';
import { ThemeProvider } from '@/components/theme-provider';
import { preferencesSchema, type Preferences } from '@/features/settings/schema';
import { changedPreferences } from '@/features/sync/reconcile';
import it from '@/messages/it.json';
import en from '@/messages/en.json';
function OfflineRoot() {
  const local = useLocalSettings();
  const locale = local.data?.snapshot.preferences.locale ?? 'it';
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : it}>
      <SessionBoundary>
        {local.data && ['/tasks', '/projects', '/today', '/review'].includes(location.pathname) ? (
          <>
            <WorkApp
              mode={location.pathname.slice(1) as 'tasks' | 'projects' | 'today' | 'review'}
            />
            <WorkOverlays />
          </>
        ) : (
          <OfflineContent />
        )}
      </SessionBoundary>
      <PwaControls />
    </NextIntlClientProvider>
  );
}
function OfflineContent() {
  const t = useTranslations();
  const local = useLocalSettings();
  const write = useLocalWrite();
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [message, setMessage] = useState('');
  const saved = local.data?.snapshot.preferences;
  const form = draft ?? saved;
  if (!form)
    return (
      <main className="offline-page">
        <a href="/today" className="brand-name">
          LifeOS
        </a>
        <h1>{local.isPending ? t('loading') : t('offlineLocked')}</h1>
        <p>{t('offlineLockedHint')}</p>
        <a href="/login" className="button button-primary">
          {t('loginButton')}
        </a>
      </main>
    );
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setDraft({ ...form, [key]: value });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || !saved) return;
    const parsed = preferencesSchema.safeParse(form);
    if (!parsed.success) {
      setMessage(t('saveError'));
      return;
    }
    try {
      await write.mutateAsync(changedPreferences(saved, parsed.data));
      setDraft(null);
      setMessage(t('queuedLocally'));
    } catch {
      setMessage(t('saveError'));
    }
  }
  return (
    <main className="offline-page">
      <ThemeProvider preferences={form} />
      <header>
        <a href="/today" className="brand-name">
          LifeOS
        </a>
        <span className="small-tag">{t('offlineSpace')}</span>
      </header>
      <p className="eyebrow">{t('preferences')}</p>
      <h1>{t('offlineTitle')}</h1>
      <p>{t('offlineDescription')}</p>
      <SyncPanel />
      <form onSubmit={save} data-unsaved={dirty} className="card">
        <div className="fields">
          <div className="field">
            <label htmlFor="timezone">{t('timezone')}</label>
            <input
              id="timezone"
              value={form.timezone}
              onChange={(e) => update('timezone', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="currency">{t('currency')}</label>
            <select
              id="currency"
              value={form.currency}
              onChange={(e) => update('currency', e.target.value as Preferences['currency'])}
            >
              {['EUR', 'USD', 'GBP', 'CHF'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="locale">{t('language')}</label>
            <select
              id="locale"
              value={form.locale}
              onChange={(e) => update('locale', e.target.value as Preferences['locale'])}
            >
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="theme">{t('theme')}</label>
            <select
              id="theme"
              value={form.theme}
              onChange={(e) => update('theme', e.target.value as Preferences['theme'])}
            >
              {['system', 'light', 'dark'].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="offline-save">
          <span role="status">{message}</span>
          <button className="button button-primary" disabled={!dirty || write.isPending}>
            {t('save')}
          </button>
        </div>
      </form>
      <a className="button button-outline" href="/today">
        {t('back')}
      </a>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <LocalProvider>
    <OfflineRoot />
  </LocalProvider>,
);
