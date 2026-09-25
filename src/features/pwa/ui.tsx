'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, RefreshCw, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { vault } from '@/features/sync/vault';
import { localSnapshot } from '@/features/sync/client';
import { isIOS, shouldOfferInstall, canApplyUpdate } from './install-policy';
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export function PwaControls() {
  const t = useTranslations();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const standalone =
      matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const offer = shouldOfferInstall(
      standalone,
      Number(localStorage.getItem('lifeos-install-dismissed') ?? 0),
      Date.now(),
    );
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (offer) setPrompt(event as InstallPrompt);
    };
    const installed = () => {
      setPrompt(null);
      setIos(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', installed);
    // Defer browser-only detection until after hydration.
    queueMicrotask(() =>
      setIos(offer && isIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)),
    );
    let disposed = false;
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((reg) => {
          if (disposed) return;
          if (reg.waiting) setWaiting(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller)
                setWaiting(worker);
            });
          });
          void reg.update().catch(() => {});
        })
        .catch(() => setMessage(t('pwaUnavailable')));
    }
    return () => {
      disposed = true;
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', installed);
    };
  }, [t]);
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') setPrompt(null);
    else dismiss();
  }
  function dismiss() {
    setDismissed(true);
    localStorage.setItem('lifeos-install-dismissed', String(Date.now() + 7 * 86400000));
  }
  async function update() {
    let pending = 0;
    try {
      pending = (await localSnapshot()).pending;
    } catch {
      if (await vault.states.count()) {
        setMessage(t('updateBlocked'));
        return;
      }
    }
    if (!canApplyUpdate(pending, document.querySelector('[data-unsaved="true"]') !== null)) {
      setMessage(t('updateBlocked'));
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
      once: true,
    });
    waiting?.postMessage({ type: 'SKIP_WAITING' });
  }
  return (
    <div className="pwa-controls">
      {waiting && (
        <section className="pwa-card">
          <RefreshCw size={20} />
          <div>
            <strong>{t('updateAvailable')}</strong>
            <p>{t('updateHint')}</p>
          </div>
          <Button onClick={update}>{t('updateReload')}</Button>
        </section>
      )}
      {!dismissed && (prompt || ios) && (
        <section className="pwa-card" aria-label={t('installTitle')}>
          <Download size={22} />
          <div>
            <strong>{t('installTitle')}</strong>
            <p>{ios ? t('installIOS') : t('installHint')}</p>
          </div>
          {prompt ? (
            <Button onClick={install}>{t('install')}</Button>
          ) : (
            <Share2 aria-hidden="true" size={22} />
          )}
          <Button variant="ghost" aria-label={t('dismiss')} onClick={dismiss}>
            <X size={18} />
          </Button>
        </section>
      )}
      {message && (
        <p className="pwa-message" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
