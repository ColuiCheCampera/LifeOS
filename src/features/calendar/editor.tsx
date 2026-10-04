'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import { v7 as uuidv7 } from 'uuid';
import { Button } from '@/components/ui/button';
import { enqueueWork } from '@/features/sync/client';
import type { WorkRecord } from '@/features/work/schema';
import { eventSchema, type CalendarEvent } from './schema';
import { bounds, occurrences } from './domain';
export function EventEditor({
  record,
  initial,
  records,
  onClose,
}: {
  record?: WorkRecord;
  initial: CalendarEvent;
  records: WorkRecord[];
  onClose: () => void;
}) {
  const english = useLocale() === 'en';
  const t = (it: string, en: string) => (english ? en : it);
  const query = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(initial);
  const wall = (value: string) =>
    initial.schedule.allDay
      ? value
      : Temporal.Instant.from(value)
          .toZonedDateTimeISO(initial.schedule.timezone)
          .toPlainDateTime()
          .toString({ smallestUnit: 'minute' });
  const [start, setStart] = useState(() => wall(initial.schedule.start));
  const [end, setEnd] = useState(() => wall(initial.schedule.end));
  const dirty =
    !record ||
    JSON.stringify(data) !== JSON.stringify(initial) ||
    start !== wall(initial.schedule.start) ||
    end !== wall(initial.schedule.end);
  const dismiss = () => {
    if (
      !lock.current &&
      (!dirty ||
        window.confirm(t('Scartare le modifiche non salvate?', 'Discard unsaved changes?')))
    )
      onClose();
  };
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  function schedule() {
    const instant = (value: string) =>
      data.schedule.allDay
        ? value
        : Temporal.PlainDateTime.from(value)
            .toZonedDateTime(data.schedule.timezone, { disambiguation: 'reject' })
            .toInstant()
            .toString();
    return { ...data.schedule, start: instant(start), end: instant(end) };
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const parsed = eventSchema.parse({ ...data, schedule: schedule() });
      await enqueueWork('event', record?.id ?? uuidv7(), parsed);
      await query.invalidateQueries();
      onClose();
    } catch {
      setError(
        t(
          'Controlla titolo, intervallo, fuso e ricorrenza. Gli orari ambigui al cambio d’ora vanno corretti.',
          'Check title, interval, timezone and recurrence. Ambiguous daylight-saving times must be corrected.',
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  let conflict = false;
  try {
    const current = bounds(schedule());
    conflict =
      occurrences(
        records.filter((r) => r.id !== record?.id),
        current.start,
        current.end,
      ).length > 0;
  } catch {}
  return (
    <dialog
      ref={dialog}
      className="work-dialog sheet-expanded"
      aria-label={t('Evento', 'Event')}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <header>
        <h2>{record ? t('Modifica evento', 'Edit event') : t('Nuovo evento', 'New event')}</h2>
        <button className="icon-button" aria-label={t('Chiudi', 'Close')} onClick={dismiss}>
          ×
        </button>
      </header>
      <form onSubmit={save} className="calendar-form" data-unsaved={dirty}>
        {record?.calendar?.readOnly && (
          <p>
            {t(
              'Questo evento Google è in sola lettura. Puoi consultarlo e chiudere il pannello con ×.',
              'This Google event is read-only. You can view it and close the panel with ×.',
            )}
          </p>
        )}
        <fieldset disabled={busy || record?.calendar?.readOnly}>
          {initial.recurrence && (
            <p>
              {t(
                'Le modifiche si applicano a tutta la serie.',
                'Changes apply to the entire series.',
              )}
            </p>
          )}
          <label>
            {t('Titolo', 'Title')}
            <input
              autoFocus
              required
              maxLength={240}
              value={data.title}
              onChange={(e) => setData({ ...data, title: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={data.schedule.allDay}
              onChange={(e) => {
                const allDay = e.target.checked;
                setData({ ...data, schedule: { ...data.schedule, allDay } });
                setStart(start ? (allDay ? start.slice(0, 10) : start + 'T09:00') : '');
                setEnd(
                  !end
                    ? ''
                    : allDay
                      ? Temporal.PlainDate.from(end.slice(0, 10))
                          .add({ days: end.slice(11) === '00:00' ? 0 : 1 })
                          .toString()
                      : Temporal.PlainDate.from(end).subtract({ days: 1 }).toString() + 'T10:00',
                );
              }}
            />
            {t('Tutto il giorno', 'All day')}
          </label>
          <label>
            {t('Inizio', 'Start')}
            <input
              required
              type={data.schedule.allDay ? 'date' : 'datetime-local'}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            {t('Fine (esclusa per eventi giornalieri)', 'End (exclusive for all-day events)')}
            <input
              required
              type={data.schedule.allDay ? 'date' : 'datetime-local'}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            {t('Fuso orario', 'Timezone')}
            <input
              required
              value={data.schedule.timezone}
              onChange={(e) =>
                setData({ ...data, schedule: { ...data.schedule, timezone: e.target.value } })
              }
            />
          </label>
          <label>
            {t('Luogo', 'Location')}
            <input
              maxLength={1000}
              value={data.location}
              onChange={(e) => setData({ ...data, location: e.target.value })}
            />
          </label>
          <label>
            {t('Note', 'Notes')}
            <textarea
              maxLength={8000}
              value={data.notes}
              onChange={(e) => setData({ ...data, notes: e.target.value })}
            />
          </label>
          <label>
            {t('Ricorrenza RRULE', 'RRULE recurrence')}
            <input
              placeholder="FREQ=WEEKLY;COUNT=4"
              disabled={!!record?.calendar}
              value={data.recurrence}
              onChange={(e) => setData({ ...data, recurrence: e.target.value })}
            />
          </label>
          <label>
            {t('Attività collegata', 'Linked task')}
            <select
              aria-label={t('Attività collegata', 'Linked task')}
              value={data.taskId ?? ''}
              onChange={(e) => setData({ ...data, taskId: e.target.value || null })}
            >
              <option value="">—</option>
              {records
                .filter((r) => r.kind === 'task' && (!r.deletedAt || r.id === data.taskId))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {String(r.data.title)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('Progetto', 'Project')}
            <select
              aria-label={t('Progetto', 'Project')}
              value={data.projectId ?? ''}
              onChange={(e) => setData({ ...data, projectId: e.target.value || null })}
            >
              <option value="">—</option>
              {records
                .filter((r) => r.kind === 'project' && (!r.deletedAt || r.id === data.projectId))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {String(r.data.title)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('Colore', 'Color')}
            <input
              type="color"
              value={data.color}
              onChange={(e) => setData({ ...data, color: e.target.value })}
            />
          </label>
          {conflict && (
            <p role="status">
              {t(
                'Questo orario si sovrappone a un altro impegno. Puoi comunque salvarlo.',
                'This time overlaps another event. You can still save it.',
              )}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <footer>
            <Button type="submit">{t('Salva', 'Save')}</Button>
            <Button type="button" variant="outline" onClick={dismiss}>
              {t('Annulla', 'Cancel')}
            </Button>
            {record && (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (
                    lock.current ||
                    !window.confirm(
                      t(
                        'Eliminare l’evento e tutte le sue ricorrenze? Ripristinabile entro 30 giorni.',
                        'Delete the event and all recurrences? Restorable within 30 days.',
                      ),
                    )
                  )
                    return;
                  lock.current = true;
                  setBusy(true);
                  try {
                    await enqueueWork('event', record.id, {}, 'delete');
                    await query.invalidateQueries();
                    onClose();
                  } catch {
                    setError(t('Eliminazione non salvata. Riprova.', 'Deletion not saved. Retry.'));
                  } finally {
                    lock.current = false;
                    setBusy(false);
                  }
                }}
              >
                {t('Elimina', 'Delete')}
              </Button>
            )}
          </footer>
        </fieldset>
      </form>
    </dialog>
  );
}
