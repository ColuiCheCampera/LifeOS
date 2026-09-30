'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useWork } from '@/features/sync/provider';
import { flush } from '@/features/sync/client';
import { eventSchema, type CalendarEvent } from './schema';
import type { GoogleCalendar } from './google';
type Status = {
  sources: {
    id: string;
    remoteId: string;
    name: string;
    enabled: boolean;
    role: string;
    lastSynced: string | null;
    error: string | null;
    unsupported: number;
    conflicts: number;
  }[];
  conflicts: {
    eventId: string;
    version: number;
    bindingVersion: number;
    local: CalendarEvent | null;
    remote: CalendarEvent | null;
  }[];
};
export function CalendarSyncPanel() {
  const english = useLocale() === 'en';
  const t = (it: string, en: string) => (english ? en : it);
  const work = useWork();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const [available, setAvailable] = useState<GoogleCalendar[] | null>(null);
  const [eventId, setEventId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const status = useQuery({
    queryKey: ['calendar-provider-status'],
    queryFn: async () => {
      const r = await fetch('/api/calendar/sync', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      return (await r.json()) as Status;
    },
    refetchInterval: 10000,
  });
  const fingerprint = status.data?.sources.map((s) => `${s.id}:${s.lastSynced}`).join('|') ?? '';
  useEffect(() => {
    if (fingerprint) void flush().catch(() => {});
  }, [fingerprint]);
  async function command(data: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await flush();
      const response = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error();
      await flush();
      await query.invalidateQueries();
      setMessage(
        t(
          'Richiesta salvata. Gli scambi Google sono eseguiti dal worker in background.',
          'Request saved. The background worker handles Google synchronization.',
        ),
      );
    } catch {
      setMessage(
        t(
          'Richiesta non completata. Verifica il collegamento Google, aggiorna i dati e riprova.',
          'Request failed. Check the Google connection, refresh your data and retry.',
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const localEvents = (work.data?.records ?? []).filter(
    (r) =>
      r.kind === 'event' && !r.deletedAt && !r.calendar && !eventSchema.parse(r.data).recurrence,
  );
  const writers =
    status.data?.sources.filter((s) => s.enabled && ['owner', 'writer'].includes(s.role)) ?? [];
  return (
    <details className="card calendar-provider">
      <summary>Google Calendar</summary>
      <p>
        {t(
          'Sincronizza i calendari selezionati. Gli eventi locali vengono pubblicati solo quando li scegli qui. Le serie ricorrenti Google e i tipi speciali non sono ancora importati; gli eventi con invitati sono in sola lettura.',
          'Sync selected calendars. Local events are published only when you select them here. Google recurring series and special event types are not imported yet; events with guests are read-only.',
        )}
      </p>
      <p>
        {t(
          'La ricerca degli spazi liberi considera solo gli eventi visibili in LifeOS.',
          'Free-slot search considers only events visible in LifeOS.',
        )}
      </p>
      <div className="calendar-toolbar">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            try {
              const r = await fetch('/api/calendar/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'calendars' }),
              });
              if (!r.ok) throw new Error();
              const data = (await r.json()) as { calendars: GoogleCalendar[] };
              setAvailable(data.calendars);
              setMessage('');
            } catch {
              setMessage(
                t(
                  'Collega o riconnetti Google Calendar nelle Impostazioni.',
                  'Connect or reconnect Google Calendar in Settings.',
                ),
              );
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          {t('Scegli calendari', 'Choose calendars')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !status.data?.sources.some((s) => s.enabled)}
          onClick={() => void command({ action: 'sync' })}
        >
          {t('Sincronizza Google', 'Sync Google')}
        </Button>
        <a className="button button-outline" href="/settings#account">
          {t('Collegamento account', 'Account connection')}
        </a>
      </div>
      {available?.map((c) => (
        <label className="calendar-task" key={c.id}>
          <input
            type="checkbox"
            checked={status.data?.sources.some((s) => s.remoteId === c.id && s.enabled) ?? false}
            disabled={busy || c.accessRole === 'freeBusyReader'}
            onChange={(e) =>
              void command({ action: 'configure', remoteId: c.id, enabled: e.target.checked })
            }
          />
          <span>
            {c.summary || c.id} ·{' '}
            {['owner', 'writer'].includes(c.accessRole)
              ? t('Modificabile', 'Writable')
              : t('Sola lettura', 'Read-only')}
          </span>
        </label>
      ))}
      {status.isError && (
        <p>
          {t(
            'Stato Google non disponibile. Gli eventi locali restano utilizzabili.',
            'Google status unavailable. Local events remain usable.',
          )}
        </p>
      )}
      {status.data?.sources.map((s) => (
        <div key={s.id} className="calendar-source">
          <strong>{s.name}</strong>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void command({ action: 'configure', remoteId: s.remoteId, enabled: !s.enabled })
            }
          >
            {s.enabled ? t('Metti in pausa', 'Pause') : t('Riprendi', 'Resume')}
          </Button>
          <p>
            {s.enabled ? t('Attivo', 'Enabled') : t('In pausa', 'Paused')} ·{' '}
            {s.lastSynced
              ? `${t('Ultimo scambio', 'Last sync')}: ${new Date(s.lastSynced).toLocaleString(english ? 'en-GB' : 'it-IT')}`
              : t('In attesa del worker', 'Waiting for worker')}
          </p>
          {s.error && (
            <p role="alert">
              {t(
                'Scambio non riuscito. Il worker riproverà; controlla il collegamento se il problema persiste.',
                'Sync failed. The worker will retry; check the connection if the problem persists.',
              )}
            </p>
          )}
          {s.unsupported > 0 && (
            <p role="status">
              {t('Elementi Google non rappresentati', 'Google items not displayed')}:{' '}
              {s.unsupported}
            </p>
          )}
        </div>
      ))}
      {writers.length > 0 && localEvents.length > 0 && (
        <fieldset disabled={busy}>
          <legend>{t('Pubblica un evento locale', 'Publish a local event')}</legend>
          <div className="calendar-toolbar">
            <label>
              {t('Evento locale', 'Local event')}
              <select
                aria-label={t('Evento locale', 'Local event')}
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                <option value="">—</option>
                {localEvents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {String(r.data.title)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Calendario di destinazione', 'Destination calendar')}
              <select
                aria-label={t('Calendario di destinazione', 'Destination calendar')}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">—</option>
                {writers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              disabled={!eventId || !sourceId}
              onClick={() => {
                const record = localEvents.find((r) => r.id === eventId);
                if (record)
                  void command({ action: 'attach', eventId, sourceId, version: record.version });
              }}
            >
              {t('Pubblica su Google', 'Publish to Google')}
            </Button>
          </div>
        </fieldset>
      )}
      {status.data?.conflicts.map((c) => (
        <section key={c.eventId} className="calendar-conflict-card">
          <h2>{t('Modifiche in conflitto', 'Conflicting changes')}</h2>
          <div className="calendar-conflict-preview">
            {[
              [t('LifeOS', 'LifeOS'), c.local],
              [t('Google', 'Google'), c.remote],
            ].map(([label, data]) => {
              const event = data as CalendarEvent | null;
              return (
                <div key={String(label)}>
                  <strong>{String(label)}</strong>
                  {event ? (
                    <>
                      <p>{event.title}</p>
                      <p>
                        {event.schedule.start} → {event.schedule.end} ({event.schedule.timezone})
                      </p>
                      <p>{event.location}</p>
                      <p className="calendar-note">{event.notes}</p>
                    </>
                  ) : (
                    <p>{t('Evento eliminato', 'Deleted event')}</p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="calendar-toolbar">
            <Button
              disabled={busy}
              variant="outline"
              onClick={() =>
                void command({
                  action: 'resolve',
                  eventId: c.eventId,
                  version: c.version,
                  bindingVersion: c.bindingVersion,
                  keepCopy: true,
                })
              }
            >
              {t('Conserva copia locale e usa Google', 'Keep local copy and use Google')}
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      'Sostituire questa versione LifeOS con quella Google?',
                      'Replace this LifeOS version with Google’s version?',
                    ),
                  )
                )
                  void command({
                    action: 'resolve',
                    eventId: c.eventId,
                    version: c.version,
                    bindingVersion: c.bindingVersion,
                    keepCopy: false,
                  });
              }}
            >
              {t('Usa solo Google', 'Use Google only')}
            </Button>
          </div>
        </section>
      ))}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
