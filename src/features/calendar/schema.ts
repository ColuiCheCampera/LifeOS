import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

export const scheduleSchema = z
  .object({
    start: z.string().max(40),
    end: z.string().max(40),
    allDay: z.boolean(),
    timezone: z.string().min(1).max(80),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value.timezone);
      if (value.allDay) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value.start) || !/^\d{4}-\d{2}-\d{2}$/.test(value.end))
          throw new Error();
        if (Temporal.PlainDate.compare(value.start, value.end) >= 0) throw new Error();
      } else if (Temporal.Instant.compare(value.start, value.end) >= 0) throw new Error();
    } catch {
      ctx.addIssue({ code: 'custom', message: 'invalid_event_interval' });
    }
  });

export const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    notes: z.string().max(8000).default(''),
    location: z.string().max(1000).default(''),
    schedule: scheduleSchema,
    taskId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#28533d'),
    recurrence: z.string().max(400).default(''),
    reminders: z.array(z.number().int().min(0).max(40320)).max(5).default([]),
  })
  .strict();
export type CalendarEvent = z.infer<typeof eventSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
