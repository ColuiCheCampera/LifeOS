import { z } from 'zod';
import { cookies } from 'next/headers';
import { apiGuard, safeRoute, json, readJson } from '@/server/api';
import { env } from '@/server/env';
import {
  calendarConnection,
  disconnectCalendar,
  listGoogleCalendars,
  startCalendarConsent,
} from '@/features/calendar/connection';
import { GoogleError } from '@/features/calendar/google';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    return json(await calendarConnection(guard.userId));
  });
export const POST = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request, true);
    if (guard.response) return guard.response;
    const parsed = z
      .object({ action: z.enum(['connect', 'disconnect', 'calendars']) })
      .strict()
      .safeParse(await readJson(request));
    if (!parsed.success) return json({ error: 'invalid_action' }, 400);
    if (parsed.data.action === 'connect') {
      const { state, url } = await startCalendarConsent(guard.userId);
      (await cookies()).set('lifeos-calendar-state', state, {
        httpOnly: true,
        secure: env.AUTH_URL.startsWith('https:'),
        sameSite: 'lax',
        path: '/api/calendar/google/callback',
        maxAge: 600,
      });
      return json({ url });
    }
    if (parsed.data.action === 'disconnect') {
      await disconnectCalendar(guard.userId);
      return json({ status: 'disconnected' });
    }
    try {
      return json({ calendars: await listGoogleCalendars(guard.userId) });
    } catch (error) {
      if (error instanceof GoogleError)
        return json({ error: error.code }, error.code === 'quota' ? 429 : 409);
      throw error;
    }
  });
