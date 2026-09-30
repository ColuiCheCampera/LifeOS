'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { GoogleCalendar } from './google';

export function CalendarConnectionPanel() {
  const result = useSearchParams().get('calendar');
  const english = useLocale() === 'en';
  const t = (it: string, en: string) => (english ? en : it);
  const [status, setStatus] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/calendar/google', { signal: controller.signal, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = (await r.json()) as { status: string };
        setStatus(data.status);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('unavailable');
      });
    return () => controller.abort();
  }, []);
  async function action(action: 'connect' | 'disconnect' | 'calendars') {
    if (lock.current) return;
    if (
      action === 'disconnect' &&
      !window.confirm(
        t(
          'Scollegare Google Calendar da LifeOS? Gli eventi locali restano disponibili.',
          'Disconnect Google Calendar from LifeOS? Local events remain available.',
        ),
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/calendar/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as {
        url?: string;
        status?: string;
        calendars?: GoogleCalendar[];
        error?: string;
      };
      if (!response.ok) {
        if (data.error === 'reconnect' || data.error === 'scope') setStatus('reconnect');
        throw new Error();
      }
      if (data.url) {
        const url = new URL(data.url);
        if (url.origin !== 'https://accounts.google.com') throw new Error();
        window.location.assign(url.toString());
      }
      if (data.status) {
        setStatus(data.status);
        setCalendars(null);
      }
      if (data.calendars) setCalendars(data.calendars);
    } catch {
      setError(
        t(
          'Richiesta non completata. Verifica la connessione o riconnetti Google Calendar.',
          'Request failed. Check your connection or reconnect Google Calendar.',
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="calendar-connection" aria-label="Google Calendar">
      <h3>Google Calendar</h3>
      <p>
        {t(
          'Il consenso è separato dal login. Puoi collegare l’account e verificare i calendari accessibili. Gli eventi del calendario LifeOS restano locali: lo scambio degli eventi con Google non è ancora attivo.',
          'Consent is separate from sign-in. Connect your account and verify available calendars. LifeOS calendar events remain local: exchanging events with Google is not yet active.',
        )}
      </p>
      {result === 'failed' && (
        <p role="alert">
          {t(
            'Collegamento non riuscito. Controlla account e permessi, poi riprova.',
            'Connection failed. Check the account and permissions, then retry.',
          )}
        </p>
      )}
      {result === 'cancelled' && (
        <p role="status">
          {t(
            'Consenso annullato. Il collegamento precedente non è stato modificato.',
            'Consent cancelled. The previous connection has not changed.',
          )}
        </p>
      )}
      <p role="status">
        {status === 'connected'
          ? t('Account collegato', 'Account connected')
          : status === 'reconnect'
            ? t(
                'Consenso scaduto: riconnetti Google Calendar',
                'Consent expired: reconnect Google Calendar',
              )
            : status === 'loading'
              ? t('Verifica collegamento…', 'Checking connection…')
              : status === 'unavailable'
                ? t('Stato non disponibile offline', 'Status unavailable offline')
                : t('Account non collegato', 'Account not connected')}
      </p>
      {status !== 'loading' && (
        <div className="calendar-toolbar">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void action('connect')}
          >
            {status === 'connected' || status === 'reconnect'
              ? t('Riconnetti Google Calendar', 'Reconnect Google Calendar')
              : t('Collega Google Calendar', 'Connect Google Calendar')}
          </Button>
          {['connected', 'reconnect'].includes(status) && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void action('disconnect')}
            >
              {t('Scollega', 'Disconnect')}
            </Button>
          )}
          {status === 'connected' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void action('calendars')}
            >
              {t('Verifica calendari', 'Check calendars')}
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {calendars && (
        <ul>
          {calendars.map((calendar) => (
            <li key={calendar.id}>
              <span
                aria-hidden="true"
                style={{
                  background: calendar.backgroundColor,
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  marginInlineEnd: 8,
                }}
              />
              <strong>{calendar.summary || calendar.id}</strong> ·{' '}
              {['owner', 'writer'].includes(calendar.accessRole)
                ? t('Lettura e scrittura', 'Read and write')
                : t('Sola lettura', 'Read only')}
              {calendar.timeZone ? ` · ${calendar.timeZone}` : ''}
            </li>
          ))}
        </ul>
      )}
      <p>
        <small>
          {t(
            'Scollega elimina le credenziali Calendar da LifeOS. Per revocare anche il consenso su Google, usa le autorizzazioni del tuo Account Google.',
            'Disconnect removes Calendar credentials from LifeOS. To revoke consent on Google too, use your Google Account permissions.',
          )}
        </small>
      </p>
    </section>
  );
}
