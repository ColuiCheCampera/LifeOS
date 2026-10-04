'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useLocalSettings, useWork } from '@/features/sync/provider';
import type { WorkRecord } from '@/features/work/schema';
import { EventEditor } from './editor';
import { eventSchema } from './schema';
import { upcomingEvents } from './domain';

export function TodayEvents() {
  const locale = useLocale();
  const english = locale === 'en';
  const t = (it: string, en: string) => (english ? en : it);
  const work = useWork();
  const preferences = useLocalSettings();
  const zone = preferences.data?.snapshot.preferences.timezone ?? 'Europe/Rome';
  const [now, setNow] = useState(() => new Date().toISOString());
  const [selected, setSelected] = useState<WorkRecord | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date().toISOString());
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, []);
  const records = work.data?.records ?? [];
  const events = upcomingEvents(records, now, zone);
  const format = (value: string, allDay: boolean) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(!allDay ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
    }).format(new Date(value));
  return (
    <section className="card today-events" aria-labelledby="today-events-title">
      <header>
        <h2 id="today-events-title">{t('Prossimi eventi', 'Upcoming events')}</h2>
        <a className="button button-outline" href="/calendar">
          {t('Apri calendario', 'Open calendar')}
        </a>
      </header>
      <p>
        {t('In corso e nei prossimi 30 giorni', 'Ongoing and in the next 30 days')} · {zone}
      </p>
      {!work.data ? (
        <p>
          {t(
            'Calendario locale non disponibile. Controlla la sincronizzazione.',
            'Local calendar unavailable. Check synchronization.',
          )}
        </p>
      ) : !events.length ? (
        <p>{t('Nessun evento salvato in questo periodo.', 'No saved events in this period.')}</p>
      ) : (
        <ol>
          {events.map((item) => {
            const data = eventSchema.parse(item.record.data);
            const ongoing = Date.parse(item.start) <= Date.parse(now);
            return (
              <li key={item.key}>
                <button className="today-event-open" onClick={() => setSelected(item.record)}>
                  <strong>{data.title}</strong>
                  <span>
                    {data.schedule.allDay
                      ? t('Tutto il giorno', 'All day')
                      : ongoing
                        ? t('In corso', 'Ongoing')
                        : t('In programma', 'Scheduled')}
                  </span>
                  <span>
                    {format(item.start, data.schedule.allDay)}
                    {!data.schedule.allDay && ` → ${format(item.end, false)}`}
                  </span>
                  {data.location && <span>{data.location}</span>}
                  <small>
                    {item.record.calendar?.name ?? t('Calendario locale', 'Local calendar')}
                    {data.recurrence && ` · ${t('Serie ricorrente', 'Recurring series')}`}
                  </small>
                  {item.record.calendar?.readOnly && (
                    <small>{t('Sola lettura', 'Read-only')}</small>
                  )}
                  {item.record.calendar?.state === 'conflict' && (
                    <small>
                      {t(
                        'Conflitto Google: apri Calendario per risolverlo',
                        'Google conflict: open Calendar to resolve it',
                      )}
                    </small>
                  )}
                </button>
                {item.record.calendar?.meetUrl && (
                  <a
                    className="button button-outline"
                    href={item.record.calendar.meetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Google Meet
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="muted">
        {t(
          'Sono mostrati fino a 5 eventi presenti in LifeOS, inclusi quelli Google già importati.',
          'Up to 5 events saved in LifeOS are shown, including Google events already imported.',
        )}
      </p>
      {selected && (
        <EventEditor
          record={selected}
          initial={eventSchema.parse(selected.data)}
          records={records}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
