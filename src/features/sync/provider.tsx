'use client';
import { useEffect, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  useMutation,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  enqueuePreferences,
  localWork,
  flush,
  localSnapshot,
  startSync,
  syncEvents,
  syncInfo,
  purgeLocal,
} from './client';
import { LockedError } from './vault';
import { Button } from '@/components/ui/button';
const queryKey = ['encrypted-local-settings'];
export function LocalProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, networkMode: 'always', refetchOnWindowFocus: false },
          mutations: { networkMode: 'always', retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SyncBridge />
      {children}
    </QueryClientProvider>
  );
}
function SyncBridge() {
  const query = useQueryClient();
  useEffect(() => {
    const update = () => {
      if (syncInfo().status === 'locked') query.clear();
      else void query.invalidateQueries();
    };
    syncEvents.addEventListener('change', update);
    const stop = startSync();
    return () => {
      stop();
      syncEvents.removeEventListener('change', update);
    };
  }, [query]);
  return null;
}
export function useLocalSettings() {
  return useQuery({ queryKey, queryFn: localSnapshot, refetchInterval: 1000 });
}
export function useLocalWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: unknown) => {
      await enqueuePreferences(patch);
      await client.invalidateQueries({ queryKey });
      if (navigator.onLine) void flush().catch(() => {});
      return localSnapshot();
    },
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
}
export function SyncPanel() {
  const t = useTranslations();
  const local = useLocalSettings();
  const [info, setInfo] = useState(syncInfo);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const update = () => setInfo(syncInfo());
    syncEvents.addEventListener('change', update);
    return () => syncEvents.removeEventListener('change', update);
  }, []);
  async function clear() {
    if (!window.confirm(t('clearCacheConfirm'))) return;
    if (navigator.onLine) {
      const csrf = (await fetch('/api/auth/csrf').then((r) => r.json())) as { csrfToken: string };
      const response = await fetch('/api/auth/signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Auth-Return-Redirect': '1',
        },
        body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: '/login' }),
      });
      if (!response.ok) {
        setMessage(t('syncError'));
        return;
      }
    }
    await purgeLocal();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Also used by the standalone offline document, outside the Next router.
    window.location.href = '/login';
  }
  async function retry() {
    try {
      await flush();
      setMessage('');
    } catch (error) {
      setMessage(error instanceof LockedError ? t('offlineLocked') : t('syncError'));
    }
  }
  return (
    <section className="sync-panel" aria-label={t('syncTitle')} data-sync-status={info.status}>
      <div>
        <strong>{t('syncTitle')}</strong>
        <p aria-live="polite">
          {t(`sync_${info.status}`)}
          {local.data?.pending ? ` · ${t('pendingChanges', { count: local.data.pending })}` : ''}
        </p>
        {info.conflicts > 0 && <p>{t('syncConflicts')}</p>}
        {message && <p role="alert">{message}</p>}
      </div>
      <div className="sync-actions">
        <Button
          type="button"
          variant="outline"
          disabled={info.status === 'syncing'}
          onClick={retry}
        >
          {t('syncNow')}
        </Button>
        <a className="button button-outline" href="/offline.html">
          {t('offlineSpace')}
        </a>
        <Button type="button" variant="ghost" onClick={clear}>
          {t('clearCache')}
        </Button>
      </div>
    </section>
  );
}
export function SessionBoundary({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const t = useTranslations();
  useEffect(() => {
    const update = () => {
      if (syncInfo().status === 'locked') setLocked(true);
      else if (syncInfo().status === 'synced') setLocked(false);
    };
    syncEvents.addEventListener('change', update);
    return () => syncEvents.removeEventListener('change', update);
  }, []);
  if (locked)
    return (
      <main className="page">
        <h1>{t('offlineLocked')}</h1>
        <p>{t('offlineLockedHint')}</p>
        <a className="button button-primary" href="/login">
          {t('loginButton')}
        </a>
      </main>
    );
  return children;
}

export function useWork() {
  return useQuery({ queryKey: ['encrypted-work'], queryFn: localWork, refetchInterval: 1000 });
}
