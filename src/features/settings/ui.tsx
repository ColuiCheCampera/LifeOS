'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import {
  UserRound,
  Globe2,
  Palette,
  ShieldCheck,
  Info,
  Search,
  Check,
  Sun,
  Moon,
  Laptop,
  ArrowUpRight,
  Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ThemeProvider } from '@/components/theme-provider';
import { SyncPanel, useLocalSettings, useLocalWrite } from '@/features/sync/provider';
import { flush, purgeLocal } from '@/features/sync/client';
import { changedPreferences } from '@/features/sync/reconcile';
import { preferencesSchema, type Preferences } from './schema';
type SessionRow = {
  id: string;
  device: string;
  createdAt: string;
  lastSeen: string;
  expires: string;
};
export function SettingsPanel({
  initial,
  email,
}: {
  initial: { preferences: Preferences; version: number };
  email: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const reduced = useReducedMotion();
  const local = useLocalSettings();
  const write = useLocalWrite();
  const saved = local.data?.snapshot.preferences ?? initial.preferences;
  const version = local.data?.snapshot.version ?? initial.version;
  const [draft, setDraft] = useState<Preferences | null>(null);
  const form = draft ?? saved;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('general');
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setDraft({ ...form, [key]: value });
    setStatus('');
  };
  const sections = [
    { key: 'account', icon: UserRound, terms: [email, t('connected')] },
    {
      key: 'general',
      icon: Globe2,
      terms: [t('language'), t('timezone'), t('currency'), t('weekStart')],
    },
    { key: 'appearance', icon: Palette, terms: [t('theme'), t('density'), t('fontSize')] },
    { key: 'security', icon: ShieldCheck, terms: [t('idle'), t('absolute'), t('sessionTitle')] },
    { key: 'about', icon: Info, terms: [t('version')] },
  ];
  const visible = sections.filter((s) =>
    [t(s.key), ...s.terms].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = preferencesSchema.safeParse(form);
    if (!parsed.success) {
      setStatus(t('saveError'));
      return;
    }
    setBusy(true);
    try {
      const securityChanged =
        form.idleMinutes !== saved.idleMinutes || form.absoluteDays !== saved.absoluteDays;
      if (securityChanged) {
        if (!navigator.onLine) throw new Error(t('securityOnlineOnly'));
        const response = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: parsed.data, version }),
        });
        if (response.status === 401) {
          await purgeLocal();
          router.push('/login');
          return;
        }
        if (!response.ok) throw new Error(response.status === 409 ? t('conflict') : t('saveError'));
        await flush();
      } else {
        const patch = changedPreferences(saved, parsed.data);
        if (Object.keys(patch).length) await write.mutateAsync(patch);
      }
      setDraft(null);
      setStatus(navigator.onLine ? t('saved') : t('queuedLocally'));
      document.cookie = `lifeos-locale=${form.locale};path=/;SameSite=Lax;max-age=31536000${location.protocol === 'https:' ? ';Secure' : ''}`;
      document.documentElement.lang = form.locale;
      if (navigator.onLine) {
        void flush()
          .then(() => router.refresh())
          .catch(() => {});
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  }
  async function loadSessions() {
    setSessionBusy(true);
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) throw new Error();
      setSessions(await response.json());
    } catch {
      setStatus(t('saveError'));
    } finally {
      setSessionBusy(false);
    }
  }
  async function revoke() {
    setSessionBusy(true);
    try {
      const response = await fetch('/api/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error();
      await purgeLocal();
      router.replace('/login');
      router.refresh();
    } catch {
      setStatus(t('saveError'));
      confirmRef.current?.close();
    } finally {
      setSessionBusy(false);
    }
  }
  const select = (key: keyof Preferences, options: { value: string; label: string }[]) => (
    <Select
      id={key}
      value={String(form[key])}
      onChange={(v) => update(key, v as never)}
      options={options}
    />
  );
  const options = (values: string[]) => values.map((v) => ({ value: v, label: t(v) }));
  return (
    <div className="page settings-page">
      <ThemeProvider preferences={form} />
      <div className="page-heading">
        <p className="eyebrow">{t('preferences')}</p>
        <h1>{t('settings')}</h1>
        <p>{t('settingsDescription')}</p>
      </div>
      <div className="settings-layout">
        <aside className="settings-nav" aria-label={t('preferences')}>
          <div className="settings-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchSettings')}
              aria-label={t('searchSettings')}
            />
          </div>
          <nav aria-label={t('settings')}>
            {sections.map(({ key, icon: Icon }) => (
              <a
                key={key}
                href={`#${key}`}
                className={active === key ? 'active' : ''}
                onClick={() => {
                  setActive(key);
                  setQuery('');
                }}
              >
                <Icon size={18} />
                {t(key)}
                <span>↗</span>
              </a>
            ))}
          </nav>
          <p className="settings-nav-note">
            <ShieldCheck size={15} />
            {t('private')}
          </p>
        </aside>
        <form onSubmit={save} className="settings-content" data-unsaved={dirty}>
          <SyncPanel />
          {visible.length === 0 && <p className="card">{t('noResults')}</p>}
          {visible.map(({ key, icon: Icon }) => (
            <motion.section
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              id={key}
              key={key}
              className="settings-card"
            >
              <div className="section-heading">
                <span className="card-icon">
                  <Icon size={20} />
                </span>
                <div>
                  <h2>{t(key)}</h2>
                  {['account', 'security', 'about'].includes(key) && (
                    <p>{t(`${key}Description`)}</p>
                  )}
                </div>
                <span className="section-number">
                  0{sections.findIndex((s) => s.key === key) + 1}
                </span>
              </div>
              {key === 'account' && (
                <>
                  <div className="account-row">
                    <span className="google-monogram">G</span>
                    <div>
                      <strong>{email}</strong>
                      <small>{t('allowlisted')}</small>
                    </div>
                    <span className="connected-tag">
                      <Check size={14} />
                      {t('connected')}
                    </span>
                  </div>
                  <div className="info-note">
                    <Info size={17} />
                    <p>{t('calendarDescription')}</p>
                  </div>
                </>
              )}
              {key === 'general' && (
                <div className="fields">
                  <div className="field">
                    <label htmlFor="locale">{t('language')}</label>
                    {select('locale', [
                      { value: 'it', label: 'Italiano' },
                      { value: 'en', label: 'English' },
                    ])}
                  </div>
                  <div className="field">
                    <label htmlFor="timezone">{t('timezone')}</label>
                    <input
                      id="timezone"
                      value={form.timezone}
                      onChange={(e) => update('timezone', e.target.value)}
                      required
                      maxLength={80}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="currency">{t('currency')}</label>
                    {select(
                      'currency',
                      ['EUR', 'USD', 'GBP', 'CHF'].map((v) => ({ value: v, label: v })),
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor="weekStart">{t('weekStart')}</label>
                    {select('weekStart', options(['monday', 'sunday']))}
                  </div>
                </div>
              )}
              {key === 'appearance' && (
                <>
                  <fieldset className="theme-fieldset">
                    <legend>{t('theme')}</legend>
                    <div className="theme-options">
                      {(
                        [
                          { key: 'light', icon: Sun },
                          { key: 'dark', icon: Moon },
                          { key: 'system', icon: Laptop },
                        ] as const
                      ).map(({ key: theme, icon: ThemeIcon }) => (
                        <label
                          className={`theme-option ${form.theme === theme ? 'selected' : ''}`}
                          key={theme}
                        >
                          <input
                            type="radio"
                            name="theme"
                            value={theme}
                            checked={form.theme === theme}
                            onChange={() => update('theme', theme)}
                          />
                          <div className={`theme-preview preview-${theme}`} aria-hidden="true">
                            <span />
                            <div>
                              <i />
                              <i />
                              <i />
                            </div>
                          </div>
                          <span className="theme-option-label">
                            <ThemeIcon size={15} />
                            {t(theme)}
                            <span className="radio-indicator" />
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="fields">
                    <div className="field">
                      <label htmlFor="density">{t('density')}</label>
                      {select('density', options(['comfortable', 'compact']))}
                    </div>
                    <div className="field">
                      <label htmlFor="fontSize">{t('fontSize')}</label>
                      {select('fontSize', options(['standard', 'large']))}
                    </div>
                  </div>
                </>
              )}
              {key === 'security' && (
                <>
                  <div className="fields">
                    <div className="field">
                      <label htmlFor="idleMinutes">{t('idle')}</label>
                      <input
                        id="idleMinutes"
                        type="number"
                        min={5}
                        max={1440}
                        value={form.idleMinutes}
                        onChange={(e) => update('idleMinutes', Number(e.target.value))}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="absoluteDays">{t('absolute')}</label>
                      <input
                        id="absoluteDays"
                        type="number"
                        min={1}
                        max={90}
                        value={form.absoluteDays}
                        onChange={(e) => update('absoluteDays', Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="session-block">
                    <div>
                      <h3>{t('sessionTitle')}</h3>
                      <p>{t('sessionDescription')}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={sessionBusy}
                      onClick={loadSessions}
                    >
                      {t('loadSessions')}
                      <ArrowUpRight size={16} />
                    </Button>
                  </div>
                  {sessions && (
                    <ul className="session-list">
                      {sessions.map((session) => (
                        <li key={session.id}>
                          <Monitor size={20} />
                          <div>
                            <strong>{session.device}</strong>
                            <small>
                              {t('lastSeen')}:{' '}
                              {new Intl.DateTimeFormat(form.locale, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                                timeZone: saved.timezone,
                              }).format(new Date(session.lastSeen))}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => confirmRef.current?.showModal()}
                  >
                    {t('revoke')}
                  </Button>
                </>
              )}
              {key === 'about' && (
                <div className="about-row">
                  <span>LifeOS</span>
                  <span className="small-tag">0.3.0 · {t('foundation')}</span>
                  <p>{t('privateDescription')}</p>
                </div>
              )}
            </motion.section>
          ))}
          <div className="save-bar">
            <span role="status" aria-live="polite">
              {status}
            </span>
            <Button type="submit" disabled={busy || !dirty || !local.data}>
              {busy ? t('saving') : t('save')}
              <Check size={16} />
            </Button>
          </div>
        </form>
      </div>
      <dialog ref={confirmRef} className="confirm-dialog">
        <h2>{t('revokeConfirm')}</h2>
        <div>
          <Button variant="outline" onClick={() => confirmRef.current?.close()}>
            {t('cancel')}
          </Button>
          <Button variant="danger" disabled={sessionBusy} onClick={revoke}>
            {t('confirm')}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
