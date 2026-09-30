import { z } from 'zod';
import { eventSchema, type CalendarEvent } from './schema';
import { Temporal } from '@js-temporal/polyfill';
const when = z.object({
  date: z.iso.date().optional(),
  dateTime: z.iso.datetime({ offset: true }).optional(),
  timeZone: z.string().max(80).optional(),
});
export const providerEventSchema = z.object({
  id: z.string().min(1).max(1024),
  etag: z.string().max(512).default(''),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).default('confirmed'),
  updated: z.iso.datetime({ offset: true }).optional(),
  summary: z.string().max(10000).optional(),
  description: z.string().max(100000).optional(),
  location: z.string().max(10000).optional(),
  start: when.optional(),
  end: when.optional(),
  recurrence: z.array(z.string().max(2000)).max(100).optional(),
  recurringEventId: z.string().optional(),
  hangoutLink: z.url().optional(),
  attendees: z.array(z.unknown()).optional(),
  eventType: z.string().optional(),
  reminders: z
    .object({
      useDefault: z.boolean(),
      overrides: z
        .array(z.object({ method: z.string(), minutes: z.number().int().min(0).max(40320) }))
        .max(5)
        .optional(),
    })
    .optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
export type ProviderEvent = z.infer<typeof providerEventSchema>;
export function providerData(event: ProviderEvent, timezone: string): CalendarEvent | null {
  if (
    event.status === 'cancelled' ||
    event.recurringEventId ||
    event.recurrence?.length ||
    (event.eventType && event.eventType !== 'default')
  )
    return null;
  const allDay = !!event.start?.date;
  const instant = (value?: string) => (value ? Temporal.Instant.from(value).toString() : undefined);
  const parsed = eventSchema.safeParse({
    title: event.summary || '(Senza titolo)',
    notes: event.description ?? '',
    location: event.location ?? '',
    schedule: {
      start: allDay ? event.start?.date : instant(event.start?.dateTime),
      end: allDay ? event.end?.date : instant(event.end?.dateTime),
      allDay,
      timezone: event.start?.timeZone ?? timezone,
    },
    reminders: event.reminders?.useDefault
      ? []
      : (event.reminders?.overrides?.filter((r) => r.method === 'popup').map((r) => r.minutes) ??
        []),
  });
  return parsed.success ? parsed.data : null;
}
export const sharedFields = ['title', 'notes', 'location', 'schedule'] as const;
export type SharedEvent = Pick<CalendarEvent, (typeof sharedFields)[number]>;
export function sharedEvent(data: CalendarEvent): SharedEvent {
  return { title: data.title, notes: data.notes, location: data.location, schedule: data.schedule };
}
export function googleBody(data: CalendarEvent) {
  const { schedule } = data;
  const when = (value: string) =>
    schedule.allDay ? { date: value } : { dateTime: value, timeZone: schedule.timezone };
  return {
    summary: data.title,
    description: data.notes,
    location: data.location,
    start: when(schedule.start),
    end: when(schedule.end),
  };
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}
export function mergeProvider(
  base: SharedEvent | null,
  local: SharedEvent | null,
  remote: SharedEvent | null,
) {
  if (equal(local, remote)) return { data: local, conflicts: [] as string[] };
  if (equal(local, base)) return { data: remote, conflicts: [] as string[] };
  if (equal(remote, base)) return { data: local, conflicts: [] as string[] };
  if (!base || !local || !remote) return { data: local, conflicts: ['deletedAt'] };
  const data = { ...local };
  const conflicts: string[] = [];
  for (const field of sharedFields) {
    if (equal(local[field], base[field])) Object.assign(data, { [field]: remote[field] });
    else if (!equal(remote[field], base[field]) && !equal(local[field], remote[field]))
      conflicts.push(field);
  }
  return { data, conflicts };
}
export function sameShared(a: SharedEvent | null, b: SharedEvent | null) {
  return equal(a, b);
}
export function sameValue(a: unknown, b: unknown) {
  return equal(a, b);
}
export function providerRetry(failures: number, random = Math.random()) {
  return Math.min(3600000, 30000 * 2 ** Math.min(failures, 7)) * (0.75 + random * 0.5);
}
