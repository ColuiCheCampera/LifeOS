import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eventSchema, scheduleSchema } from '@/features/calendar/schema';
import {
  bounds,
  calendarRange,
  freeSlot,
  moveSchedule,
  occurrences,
  overlaps,
  upcomingEvents,
  eventSearchScore,
} from '@/features/calendar/domain';
import { applyWork } from '@/features/work/domain';
import type { WorkRecord, WorkMutation } from '@/features/work/schema';

const schedule = {
  start: '2026-03-28T08:00:00Z',
  end: '2026-03-28T09:00:00Z',
  allDay: false,
  timezone: 'Europe/Rome',
};
function event(patch = {}): WorkRecord {
  return {
    id: randomUUID(),
    kind: 'event',
    data: eventSchema.parse({ title: 'Test', schedule, ...patch }),
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    deletedAt: null,
    version: 1,
    clocks: {},
  };
}
describe('calendar intervals and views', () => {
  it('selects ongoing and upcoming occurrences, excludes ended/deleted events and caps results', () => {
    const past = event({ schedule: { ...schedule, end: '2026-03-28T08:30:00Z' } });
    const ongoing = event();
    const recurring = event({ title: 'Series', recurrence: 'FREQ=DAILY;COUNT=8' });
    const deleted = { ...event(), deletedAt: '2026-03-28T08:00:00Z' };
    const items = upcomingEvents(
      [past, ongoing, recurring, deleted],
      '2026-03-28T08:30:00Z',
      'Europe/Rome',
    );
    expect(items).toHaveLength(5);
    expect(items.some((item) => item.record.id === past.id || item.record.id === deleted.id)).toBe(
      false,
    );
    expect(items.some((item) => item.record.id === ongoing.id)).toBe(true);
    expect(items.some((item) => item.start === '2026-03-29T07:00:00Z')).toBe(true);
  });
  it('uses the selected timezone and exclusive all-day end, and searches accented event metadata', () => {
    const day = event({
      title: 'Caffè',
      location: 'Biblioteca',
      notes: 'Portare documenti',
      schedule: {
        start: '2026-03-29',
        end: '2026-03-30',
        timezone: 'Europe/Rome',
        allDay: true,
      },
    });
    expect(upcomingEvents([day], '2026-03-29T21:59:59Z', 'Europe/Rome')).toHaveLength(1);
    expect(upcomingEvents([day], '2026-03-29T22:00:00Z', 'Europe/Rome')).toHaveLength(0);
    expect(eventSearchScore(day, 'caffe')).toBeGreaterThanOrEqual(0);
    expect(eventSearchScore(day, 'biblioteca')).toBeGreaterThanOrEqual(0);
    expect(eventSearchScore(day, 'documenti')).toBeGreaterThanOrEqual(0);
    expect(eventSearchScore(day, 'zzzzzz')).toBeLessThan(0);
  });
  it('rejects invalid intervals, dates and zones', () => {
    for (const patch of [
      { end: schedule.start },
      { start: schedule.end },
      { timezone: 'invalid' },
      { start: '2026-01-01' },
      { allDay: true, start: '2026-02-30', end: '2026-03-03' },
      { allDay: true, start: '2026-3-1', end: '2026-03-03' },
      { allDay: true, start: '2026-03-03', end: '2026-03-03' },
    ])
      expect(scheduleSchema.safeParse({ ...schedule, ...patch }).success).toBe(false);
    expect(eventSchema.safeParse({ title: 'a', schedule, reminders: [-1] }).success).toBe(false);
    expect(eventSchema.safeParse({ title: 'a', schedule, injected: true }).success).toBe(false);
  });
  it('uses exclusive end dates and DST-length all-day intervals', () => {
    expect(
      bounds({ start: '2026-03-29', end: '2026-03-30', allDay: true, timezone: 'Europe/Rome' }),
    ).toEqual({ start: '2026-03-28T23:00:00Z', end: '2026-03-29T22:00:00Z' });
    expect(bounds(schedule)).toEqual({ start: schedule.start, end: schedule.end });
    expect(
      overlaps(
        { start: schedule.start, end: schedule.end },
        { start: schedule.end, end: '2026-03-28T10:00:00Z' },
      ),
    ).toBe(false);
  });
  it('respects first-day preferences and month boundaries', () => {
    expect(calendarRange('2026-09-29', 'week')).toEqual({ start: '2026-09-28', end: '2026-10-05' });
    expect(calendarRange('2026-09-29', 'week', 0)).toEqual({
      start: '2026-09-27',
      end: '2026-10-04',
    });
    expect(calendarRange('2026-02-20', 'month')).toEqual({
      start: '2026-02-01',
      end: '2026-03-01',
    });
    expect(calendarRange('2026-12-31', 'three').end).toBe('2027-01-03');
    expect(calendarRange('2026-09-29', 'day').end).toBe('2026-09-30');
    expect(calendarRange('2026-09-29', 'agenda').end).toBe('2026-10-29');
  });
  it('moves all-day and timed events preserving wall-clock time over DST', () => {
    expect(moveSchedule(schedule, 1).start).toBe('2026-03-29T07:00:00Z');
    expect(moveSchedule(schedule, 0, 15).end).toBe('2026-03-28T09:15:00Z');
    expect(
      moveSchedule({ ...schedule, allDay: true, start: '2026-12-31', end: '2027-01-01' }, 1),
    ).toMatchObject({ start: '2027-01-01', end: '2027-01-02' });
  });
});
describe('calendar recurrence and planning', () => {
  it('retains positive elapsed duration through repeated and skipped wall-clock hours', () => {
    const fall = event({
      recurrence: 'FREQ=DAILY;COUNT=2',
      schedule: { ...schedule, start: '2026-10-25T00:45:00Z', end: '2026-10-25T01:15:00Z' },
    });
    const repeated = occurrences([fall], '2026-10-25T00:00:00Z', '2026-10-27T00:00:00Z');
    expect(repeated).toHaveLength(2);
    for (const item of repeated)
      expect(Date.parse(item.end) - Date.parse(item.start)).toBe(1800000);
    const spring = event({
      recurrence: 'FREQ=DAILY;COUNT=2',
      schedule: { ...schedule, start: '2026-03-28T00:45:00Z', end: '2026-03-28T01:15:00Z' },
    });
    const skipped = occurrences([spring], '2026-03-29T01:00:00Z', '2026-03-29T01:15:00Z');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      start: '2026-03-29T00:45:00Z',
      end: '2026-03-29T01:15:00Z',
    });
  });
  it('expands a finite recurrence through DST and clips to overlapping range', () => {
    const recurring = event({ recurrence: 'FREQ=DAILY;COUNT=3' });
    const result = occurrences([recurring], '2026-03-28T00:00:00Z', '2026-04-02T00:00:00Z');
    expect(result.map((r) => r.start)).toEqual([
      '2026-03-28T08:00:00Z',
      '2026-03-29T07:00:00Z',
      '2026-03-30T07:00:00Z',
    ]);
    expect(result.map((r) => r.end)).toEqual([
      '2026-03-28T09:00:00Z',
      '2026-03-29T08:00:00Z',
      '2026-03-30T08:00:00Z',
    ]);
    expect(occurrences([recurring], '2026-03-29T07:30:00Z', '2026-03-29T08:00:00Z')).toHaveLength(
      1,
    );
    expect(occurrences([recurring], '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z')).toHaveLength(
      0,
    );
  });
  it('includes multi-day/all-day recurrences and omits tombstones and other entities', () => {
    const allDay = event({
      schedule: { ...schedule, allDay: true, start: '2026-03-28', end: '2026-03-30' },
      recurrence: 'FREQ=WEEKLY;COUNT=2',
    });
    const normal = event();
    const result = occurrences(
      [
        allDay,
        normal,
        { ...normal, id: randomUUID(), deletedAt: '2026-03-01T00:00:00Z' },
        { ...normal, kind: 'task' },
      ],
      '2026-03-27T00:00:00Z',
      '2026-04-06T00:00:00Z',
    );
    expect(result).toHaveLength(3);
    expect(result[0].start).toBe('2026-03-27T23:00:00Z');
    expect(result[0].end).toBe('2026-03-29T22:00:00Z');
    expect(occurrences([normal], '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z')).toEqual([]);
  });
  it('finds slots across overlapping, adjacent and out-of-range events', () => {
    const at = (hour: number) => `2026-03-28T${String(hour).padStart(2, '0')}:00:00Z`;
    const events = [
      { start: at(7), end: at(8) },
      { start: at(9), end: at(11) },
      { start: at(10), end: at(12) },
      { start: at(15), end: at(16) },
    ];
    expect(freeSlot(events, at(9), at(18), 60)).toBe('2026-03-28T12:00:00.000Z');
    expect(freeSlot(events, at(8), at(18), 60)).toBe('2026-03-28T08:00:00.000Z');
    expect(freeSlot(events, at(16), at(18), 120)).toBe('2026-03-28T16:00:00.000Z');
    expect(freeSlot(events, at(9), at(12), 60)).toBe(null);
    expect(freeSlot(events, at(8), at(9), 90)).toBe(null);
    expect(() => freeSlot(events, at(9), at(18), 0)).toThrow('invalid_duration');
  });
  it('validates task ownership, recurrence and atomic interval reconciliation', () => {
    const record = event();
    const mutation: WorkMutation = {
      id: randomUUID(),
      clientId: randomUUID(),
      recordId: record.id,
      kind: 'event',
      at: Date.now(),
      operation: 'upsert',
      patch: { schedule: moveSchedule(schedule, 1) },
    };
    const next = applyWork({ records: [record], revision: 1 }, mutation);
    expect(next.snapshot.records[0].data.schedule).toMatchObject({
      start: '2026-03-29T07:00:00Z',
      end: '2026-03-29T08:00:00Z',
    });
    expect(
      applyWork(next.snapshot, { ...mutation, at: mutation.at - 1, patch: { schedule } }).conflicts,
    ).toContain('schedule');
    expect(() =>
      applyWork(
        { records: [record], revision: 1 },
        { ...mutation, patch: { taskId: randomUUID() } },
      ),
    ).toThrow('missing_relation');
    expect(() =>
      applyWork(
        { records: [record], revision: 1 },
        { ...mutation, patch: { recurrence: 'FREQ=SECONDLY' } },
      ),
    ).toThrow('invalid_recurrence');
  });
});
