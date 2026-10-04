'use client';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import { EventEditor } from './editor';
import { Button } from '@/components/ui/button';
import { SyncPanel, useLocalSettings, useWork } from '@/features/sync/provider';
import { enqueueWork } from '@/features/sync/client';
import { dateAt, todayIn } from '@/features/work/domain';
import type { WorkRecord } from '@/features/work/schema';
import { eventSchema, type CalendarEvent } from './schema';
import { calendarRange, freeSlot, moveSchedule, occurrences, overlaps } from './domain';
import { CalendarSyncPanel } from './sync-ui';

export function CalendarApp() {
  const english = useLocale() === 'en';
  const t = (it: string, en: string) => (english ? en : it);
  const work = useWork();
  const settings = useLocalSettings();
  const query = useQueryClient();
  const zone = settings.data?.snapshot.preferences.timezone ?? 'Europe/Rome';
  const [date, setDate] = useState(() => todayIn(zone));
  const [view, setView] = useState('week');
  const [edit, setEdit] = useState<{ record?: WorkRecord; initial: CalendarEvent } | null>(null);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [hidden, setHidden] = useState(false);
  const records = work.data?.records ?? [];
  const range = calendarRange(
    date,
    view,
    settings.data?.snapshot.preferences.weekStart === 'sunday' ? 0 : 1,
  );
  const from = Temporal.PlainDate.from(range.start).toZonedDateTime(zone).toInstant().toString();
  const to = Temporal.PlainDate.from(range.end).toZonedDateTime(zone).toInstant().toString();
  const events = occurrences(records, from, to);
  const days: string[] = [];
  for (
    let day = Temporal.PlainDate.from(range.start);
    day.toString() < range.end;
    day = day.add({ days: 1 })
  )
    days.push(day.toString());
  const tasks = records.filter(
    (r) => r.kind === 'task' && !r.deletedAt && r.data.status !== 'done',
  );
  function create(day = date, task?: WorkRecord, instant?: string) {
    const start = instant ?? dateAt(day, '09:00', zone);
    setEdit({
      initial: eventSchema.parse({
        title: task?.data.title ?? t('Nuovo evento', 'New event'),
        taskId: task?.id ?? null,
        projectId: task?.data.projectId ?? null,
        schedule: {
          start,
          end: Temporal.Instant.from(start)
            .add({ minutes: Math.max(15, Math.min(480, Number(task?.data.estimate) || 60)) })
            .toString(),
          timezone: zone,
          allDay: false,
        },
      }),
    });
  }
  async function write(
    record: WorkRecord,
    patch: Record<string, unknown>,
    operation: 'upsert' | 'delete' | 'restore' = 'upsert',
  ) {
    try {
      await enqueueWork('event', record.id, patch, operation);
      await query.invalidateQueries();
      setMessage('');
    } catch {
      setMessage(
        t(
          'Modifica non salvata. Controlla la sincronizzazione e riprova.',
          'Change not saved. Check sync and retry.',
        ),
      );
    }
  }
  function navigate(direction: number) {
    const current = Temporal.PlainDate.from(date);
    setDate(
      (view === 'month'
        ? current.add({ months: direction })
        : current.add({
            days:
              direction * (view === 'day' ? 1 : view === 'three' ? 3 : view === 'week' ? 7 : 30),
          })
      ).toString(),
    );
  }
  const formatDate = (day: string) =>
    Temporal.PlainDate.from(day).toLocaleString(english ? 'en-GB' : 'it-IT', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const formatTime = (instant: string) =>
    Temporal.Instant.from(instant)
      .toZonedDateTimeISO(zone)
      .toPlainTime()
      .toString({ smallestUnit: 'minute' });
  return (
    <div className="page work-page calendar-page">
      <header className="page-heading calendar-heading">
        <div>
          <p className="eyebrow">LIFEOS / {t('IL TUO TEMPO', 'YOUR TIME')}</p>
          <h1>{t('Calendario', 'Calendar')}</h1>
          <p>
            {t(
              'Organizza gli impegni e dedica tempo alle attività.',
              'Plan events and make time for your tasks.',
            )}
          </p>
        </div>
        <Button onClick={() => create()} disabled={!work.data}>
          {t('Nuovo evento', 'New event')}
        </Button>
      </header>
      <SyncPanel />
      <CalendarSyncPanel />
      <div className="calendar-toolbar">
        <Button
          variant="outline"
          aria-label={t('Periodo precedente', 'Previous period')}
          onClick={() => navigate(-1)}
        >
          ←
        </Button>
        <Button variant="outline" onClick={() => setDate(todayIn(zone))}>
          {t('Oggi', 'Today')}
        </Button>
        <Button
          variant="outline"
          aria-label={t('Periodo successivo', 'Next period')}
          onClick={() => navigate(1)}
        >
          →
        </Button>
        <label>
          {t('Data', 'Date')}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        <label>
          {t('Vista', 'View')}
          <select
            aria-label={t('Vista', 'View')}
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            {[
              ['day', t('Giorno', 'Day')],
              ['three', t('3 giorni', '3 days')],
              ['week', t('Settimana', 'Week')],
              ['month', t('Mese', 'Month')],
              ['agenda', 'Agenda'],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <small>{zone}</small>
      </div>
      {message && <p role="alert">{message}</p>}
      {!work.data && (
        <p role="status">{t('Apertura del calendario locale…', 'Opening local calendar…')}</p>
      )}
      <div className={`calendar-grid calendar-${view}`}>
        {days.map((day, index) => {
          const dayStart = Temporal.PlainDate.from(day)
            .toZonedDateTime(zone)
            .toInstant()
            .toString();
          const dayEnd = Temporal.PlainDate.from(day)
            .add({ days: 1 })
            .toZonedDateTime(zone)
            .toInstant()
            .toString();
          const daily = events.filter((event) => overlaps(event, { start: dayStart, end: dayEnd }));
          return (
            <section
              key={day}
              className={`calendar-day ${day === todayIn(zone) ? 'is-today' : ''}`}
              style={
                view === 'month' && index === 0
                  ? {
                      gridColumnStart:
                        ((Temporal.PlainDate.from(day).dayOfWeek -
                          (settings.data?.snapshot.preferences.weekStart === 'sunday' ? 7 : 1) +
                          7) %
                          7) +
                        1,
                    }
                  : undefined
              }
              aria-label={formatDate(day)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const task = tasks.find((r) => r.id === e.dataTransfer.getData('lifeos-task'));
                if (task) return create(day, task);
                const event = records.find(
                  (r) => r.kind === 'event' && r.id === e.dataTransfer.getData('lifeos-event'),
                );
                if (event) {
                  if (event.calendar?.readOnly) return;
                  const data = eventSchema.parse(event.data);
                  const oldDay = data.schedule.allDay
                    ? data.schedule.start
                    : Temporal.Instant.from(data.schedule.start)
                        .toZonedDateTimeISO(zone)
                        .toPlainDate()
                        .toString();
                  const days = Temporal.PlainDate.from(oldDay).until(day).days;
                  if (
                    !data.recurrence ||
                    window.confirm(t('Spostare tutta la serie?', 'Move the entire series?'))
                  )
                    void write(event, { schedule: moveSchedule(data.schedule, days) });
                }
              }}
            >
              <header>
                <h2>{formatDate(day)}</h2>
                <button
                  className="icon-button"
                  aria-label={`${t('Aggiungi evento', 'Add event')}: ${day}`}
                  onClick={() => create(day)}
                >
                  +
                </button>
              </header>
              {daily.length === 0 && (
                <p className="calendar-empty">{t('Nessun impegno', 'No events')}</p>
              )}
              {daily.map((event) => {
                const data = eventSchema.parse(event.record.data);
                const conflict = events.some(
                  (other) => other.key !== event.key && overlaps(event, other),
                );
                return (
                  <article
                    key={event.key}
                    className="calendar-event"
                    style={{ borderInlineStartColor: event.record.calendar?.color ?? data.color }}
                    draggable={!data.recurrence && !event.record.calendar?.readOnly}
                    onDragStart={(e) => e.dataTransfer.setData('lifeos-event', event.record.id)}
                  >
                    <button
                      className="calendar-event-open"
                      onClick={() => setEdit({ record: event.record, initial: data })}
                    >
                      <small>
                        {data.schedule.allDay
                          ? t('Tutto il giorno', 'All day')
                          : `${formatTime(event.start)}–${formatTime(event.end)}`}
                        {data.recurrence ? ' ↻' : ''}
                      </small>
                      <strong>{data.title}</strong>
                    </button>
                    {data.location && <small>{data.location}</small>}
                    {event.record.calendar && (
                      <small>
                        {event.record.calendar.name} ·{' '}
                        {event.record.calendar.readOnly
                          ? t('Sola lettura', 'Read-only')
                          : event.record.calendar.state === 'conflict'
                            ? t('Conflitto Google', 'Google conflict')
                            : event.record.calendar.state === 'pending'
                              ? t('Da inviare a Google', 'Pending Google sync')
                              : t('Collegato a Google', 'Linked to Google')}
                      </small>
                    )}
                    {event.record.calendar?.meetUrl && (
                      <a
                        className="button button-outline"
                        href={event.record.calendar.meetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Google Meet
                      </a>
                    )}
                    {data.taskId && <small>{t('Blocco attività', 'Task time block')}</small>}
                    {conflict && (
                      <small className="calendar-conflict">
                        {t('Sovrapposizione', 'Overlapping event')}
                      </small>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      <section className="card calendar-planning">
        <h2>{t('Dedica tempo a un’attività', 'Make time for a task')}</h2>
        <p>
          {t(
            'Trascina un’attività su un giorno oppure usa i pulsanti. Lo spazio libero viene cercato tra le 09:00 e le 18:00 nella data selezionata.',
            'Drag a task to a day or use the buttons. Free slots are searched between 09:00 and 18:00 on the selected date.',
          )}
        </p>
        {tasks.length === 0 && (
          <p>
            {t('Le attività da pianificare compariranno qui.', 'Tasks to plan will appear here.')}
          </p>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            className="calendar-task"
            draggable
            onDragStart={(e) => e.dataTransfer.setData('lifeos-task', task.id)}
          >
            <strong>{String(task.data.title)}</strong>
            <Button variant="outline" onClick={() => create(date, task)}>
              {t('Pianifica', 'Schedule')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const start = dateAt(date, '09:00', zone),
                  end = dateAt(date, '18:00', zone);
                const slot = freeSlot(
                  occurrences(records, start, end),
                  start,
                  end,
                  Math.max(15, Math.min(480, Number(task.data.estimate) || 60)),
                );
                if (slot) create(date, task, slot);
                else
                  setMessage(
                    t(
                      'Nessuno spazio disponibile nella data selezionata.',
                      'No free slot on the selected date.',
                    ),
                  );
              }}
            >
              {t('Trova spazio', 'Find free slot')}
            </Button>
          </div>
        ))}
      </section>
      <section className="card">
        <Button variant="ghost" aria-expanded={hidden} onClick={() => setHidden(!hidden)}>
          {t('Cestino eventi', 'Event trash')}
        </Button>
        {hidden &&
          records
            .filter((r) => r.kind === 'event' && r.deletedAt)
            .map((r) => (
              <div className="calendar-task" key={r.id}>
                <span>{String(r.data.title)}</span>
                <Button
                  variant="outline"
                  disabled={
                    now - Date.parse(r.deletedAt!) > 30 * 86400000 ||
                    !!r.calendar?.readOnly ||
                    r.calendar?.canRestore === false
                  }
                  onClick={() => void write(r, {}, 'restore')}
                >
                  {t('Ripristina', 'Restore')}
                </Button>
                {r.calendar && (
                  <Button
                    variant="outline"
                    onClick={() => setEdit({ initial: eventSchema.parse(r.data) })}
                  >
                    {t('Crea copia locale', 'Create local copy')}
                  </Button>
                )}
              </div>
            ))}
      </section>
      {edit && (
        <EventEditor
          key={edit.record?.id ?? 'new'}
          {...edit}
          records={records}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
