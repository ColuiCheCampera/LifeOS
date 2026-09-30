import { Temporal } from '@js-temporal/polyfill';
import { rrulestr } from 'rrule';
import { eventSchema, type Schedule } from './schema';
import type { WorkRecord } from '@/features/work/schema';

export type Occurrence = { record: WorkRecord; start: string; end: string; key: string };
export function bounds(schedule: Schedule) {
  const instant = (value: string) =>
    schedule.allDay
      ? Temporal.PlainDate.from(value).toZonedDateTime(schedule.timezone).toInstant().toString()
      : Temporal.Instant.from(value).toString();
  return { start: instant(schedule.start), end: instant(schedule.end) };
}
export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);
}
export function calendarRange(date: string, view: string, weekStart = 1) {
  let start = Temporal.PlainDate.from(date);
  if (view === 'week')
    start = start.subtract({ days: (start.dayOfWeek - (weekStart || 7) + 7) % 7 });
  if (view === 'month') start = start.with({ day: 1 });
  const end =
    view === 'month'
      ? start.add({ months: 1 })
      : start.add({ days: view === 'day' ? 1 : view === 'three' ? 3 : view === 'week' ? 7 : 30 });
  return { start: start.toString(), end: end.toString() };
}
export function occurrences(records: WorkRecord[], from: string, to: string): Occurrence[] {
  const result: Occurrence[] = [];
  for (const record of records.filter((r) => r.kind === 'event' && !r.deletedAt)) {
    const event = eventSchema.parse(record.data);
    const interval = bounds(event.schedule);
    if (!event.recurrence) {
      if (overlaps(interval, { start: from, end: to }))
        result.push({ record, ...interval, key: record.id });
      continue;
    }
    const zone = event.schedule.timezone;
    const start = Temporal.Instant.from(interval.start).toZonedDateTimeISO(zone);
    const end = Temporal.Instant.from(interval.end).toZonedDateTimeISO(zone);
    const floating = (d: Temporal.ZonedDateTime) =>
      new Date(d.toPlainDateTime().toString({ smallestUnit: 'second' }) + 'Z');
    const duration = event.schedule.allDay
      ? floating(end).getTime() - floating(start).getTime()
      : Date.parse(interval.end) - Date.parse(interval.start);
    const rule = rrulestr(
      `DTSTART:${floating(start).toISOString().replace(/[-:]/g, '').replace('.000', '')}\nRRULE:${event.recurrence}`,
    );
    // Expand in wall-clock time, then convert each occurrence: recurring 09:00 stays 09:00 over DST.
    const lower =
      floating(Temporal.Instant.from(from).toZonedDateTimeISO(zone)).getTime() -
      duration -
      2 * 86400000;
    const upper = floating(Temporal.Instant.from(to).toZonedDateTimeISO(zone));
    const dates = rule.between(new Date(lower), upper, true, (_, index) => index < 2000);
    for (const date of dates) {
      const convert = (ms: number) =>
        Temporal.PlainDateTime.from(new Date(ms).toISOString().slice(0, 19))
          .toZonedDateTime(zone, { disambiguation: 'compatible' })
          .toInstant()
          .toString();
      const occurrenceStart = convert(date.getTime());
      const candidate = {
        start: occurrenceStart,
        end: event.schedule.allDay
          ? convert(date.getTime() + duration)
          : Temporal.Instant.from(occurrenceStart).add({ milliseconds: duration }).toString(),
      };
      if (overlaps(candidate, { start: from, end: to }))
        result.push({ record, ...candidate, key: `${record.id}:${candidate.start}` });
    }
  }
  return result.sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || a.record.id.localeCompare(b.record.id),
  );
}
export function freeSlot(
  events: { start: string; end: string }[],
  from: string,
  to: string,
  minutes: number,
) {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('invalid_duration');
  let cursor = Date.parse(from);
  const limit = Date.parse(to),
    duration = minutes * 60000;
  for (const event of [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const start = Date.parse(event.start),
      end = Date.parse(event.end);
    if (end <= cursor || start >= limit) continue;
    if (cursor + duration <= start) return new Date(cursor).toISOString();
    cursor = Math.max(cursor, end);
  }
  return cursor + duration <= limit ? new Date(cursor).toISOString() : null;
}
export function moveSchedule(schedule: Schedule, days: number, minutes = 0): Schedule {
  if (schedule.allDay)
    return {
      ...schedule,
      start: Temporal.PlainDate.from(schedule.start).add({ days }).toString(),
      end: Temporal.PlainDate.from(schedule.end).add({ days }).toString(),
    };
  const shift = (value: string) =>
    Temporal.Instant.from(value)
      .toZonedDateTimeISO(schedule.timezone)
      .add({ days, minutes })
      .toInstant()
      .toString();
  return { ...schedule, start: shift(schedule.start), end: shift(schedule.end) };
}
