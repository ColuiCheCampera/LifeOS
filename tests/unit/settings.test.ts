import { describe, it, expect } from 'vitest';
import {
  preferencesSchema,
  settingsUpdateSchema,
  defaultPreferences,
} from '@/features/settings/schema';
import { readEnv } from '@/server/env';
import { testEnv } from '../env';
describe('settings schema', () => {
  it('provides Italian defaults', () =>
    expect(defaultPreferences).toMatchObject({
      locale: 'it',
      timezone: 'Europe/Rome',
      currency: 'EUR',
      weekStart: 'monday',
    }));
  it.each([
    { timezone: 'not-a-zone' },
    { idleMinutes: 0 },
    { idleMinutes: 1441 },
    { absoluteDays: 91 },
    { currency: 'INVALID' },
    { locale: 'es' },
    { theme: 'invalid' },
    { unexpected: true },
  ])('rejects %j', (v) => expect(preferencesSchema.safeParse(v).success).toBe(false));
  it('accepts valid updates with a version', () =>
    expect(
      settingsUpdateSchema.safeParse({
        preferences: { ...defaultPreferences, locale: 'en', timezone: 'America/New_York' },
        version: 1,
      }).success,
    ).toBe(true));
  it('rejects missing or negative version', () => {
    expect(settingsUpdateSchema.safeParse({ preferences: {} }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ preferences: {}, version: -1 }).success).toBe(false);
  });
});
describe('boot environment', () => {
  it('disables push by default and requires HTTPS when explicitly enabled', () => {
    expect(readEnv(testEnv).CALENDAR_PUSH_ENABLED).toBe('false');
    expect(() => readEnv({ ...testEnv, CALENDAR_PUSH_ENABLED: 'true' })).toThrow('HTTPS');
    expect(
      readEnv({ ...testEnv, CALENDAR_PUSH_ENABLED: 'true', AUTH_URL: 'https://lifeos.test' })
        .CALENDAR_PUSH_ENABLED,
    ).toBe('true');
  });
  it('validates required config', () =>
    expect(readEnv(testEnv).ALLOWED_EMAIL).toBe('owner@example.test'));
  it('does not print values on failure', () => {
    expect(() => readEnv({ ...testEnv, AUTH_SECRET: 'SENSITIVE' })).toThrow('AUTH_SECRET');
    expect(() => readEnv({ ...testEnv, AUTH_SECRET: 'SENSITIVE' })).not.toThrow('SENSITIVE');
  });
  it('rejects non-postgres database and malformed key', () => {
    expect(() => readEnv({ ...testEnv, DATABASE_URL: 'https://example.test' })).toThrow();
    expect(() => readEnv({ ...testEnv, ENCRYPTION_KEY: 'short' })).toThrow();
  });
  it('requires HTTPS in production', () => {
    expect(() => readEnv({ ...testEnv, NODE_ENV: 'production' })).toThrow('HTTPS');
    expect(
      readEnv({ ...testEnv, AUTH_URL: 'https://lifeos.test', NODE_ENV: 'production' }).AUTH_URL,
    ).toBe('https://lifeos.test');
  });
  it('defaults demo mode to off', () => {
    const copy: { [key: string]: string | undefined } = { ...testEnv, DEMO_MODE: undefined };
    expect(readEnv(copy).DEMO_MODE).toBe('false');
  });
});
