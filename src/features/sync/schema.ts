import { z } from 'zod';
import { workSnapshotSchema, workMutationSchema } from '@/features/work/schema';
import { preferencesSchema } from '@/features/settings/schema';
export const offlineFields = [
  'locale',
  'timezone',
  'currency',
  'weekStart',
  'theme',
  'density',
  'fontSize',
] as const;
export type OfflineField = (typeof offlineFields)[number];
export const patchSchema = z
  .object({
    locale: preferencesSchema.shape.locale.removeDefault().optional(),
    timezone: preferencesSchema.shape.timezone.removeDefault().optional(),
    currency: preferencesSchema.shape.currency.removeDefault().optional(),
    weekStart: preferencesSchema.shape.weekStart.removeDefault().optional(),
    theme: preferencesSchema.shape.theme.removeDefault().optional(),
    density: preferencesSchema.shape.density.removeDefault().optional(),
    fontSize: preferencesSchema.shape.fontSize.removeDefault().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0);
export const clockSchema = z
  .object({
    at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    clientId: z.string().min(1).max(80),
  })
  .strict();
export type FieldClock = z.infer<typeof clockSchema>;
export type FieldClocks = Partial<Record<keyof z.infer<typeof preferencesSchema>, FieldClock>>;
export const clocksSchema = z.partialRecord(
  z.enum([...offlineFields, 'idleMinutes', 'absoluteDays']),
  clockSchema,
);
export const mutationSchema = z
  .object({
    id: z.uuid(),
    clientId: z.uuid(),
    at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    entity: z.literal('settings'),
    patch: patchSchema,
  })
  .strict();
export type SettingsMutation = z.infer<typeof mutationSchema>;
export const snapshotSchema = z
  .object({
    preferences: preferencesSchema,
    version: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
    clocks: clocksSchema,
  })
  .strict();
export type SettingsSnapshot = z.infer<typeof snapshotSchema>;
export const bootstrapSchema = z
  .object({
    userId: z.uuid(),
    expiresAt: z.number().int().positive(),
    snapshot: snapshotSchema,
    work: workSnapshotSchema.optional(),
  })
  .strict();
export const acknowledgementSchema = z
  .object({
    mutationId: z.uuid(),
    snapshot: snapshotSchema,
    conflicts: z.array(z.enum(offlineFields)),
  })
  .strict();
export const localStateSchema = z
  .object({
    snapshot: snapshotSchema,
    queue: z.array(mutationSchema).max(1000),
    work: workSnapshotSchema.optional(),
    workQueue: z.array(workMutationSchema).max(1000).optional(),
    clientId: z.uuid(),
    lastClock: z.number().int().nonnegative(),
  })
  .strict();
export type LocalState = z.infer<typeof localStateSchema>;
