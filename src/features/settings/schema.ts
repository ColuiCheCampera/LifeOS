import { z } from 'zod';
export const preferencesSchema = z
  .object({
    locale: z.enum(['it', 'en']).default('it'),
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('it', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      })
      .default('Europe/Rome'),
    currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).default('EUR'),
    weekStart: z.enum(['monday', 'sunday']).default('monday'),
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    density: z.enum(['comfortable', 'compact']).default('comfortable'),
    fontSize: z.enum(['standard', 'large']).default('standard'),
    idleMinutes: z.number().int().min(5).max(1440).default(60),
    absoluteDays: z.number().int().min(1).max(90).default(30),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences = preferencesSchema.parse({});
export const settingsUpdateSchema = z
  .object({ preferences: preferencesSchema, version: z.number().int().positive() })
  .strict();
