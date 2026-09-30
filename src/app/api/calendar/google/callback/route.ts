import { cookies } from 'next/headers';
import { apiGuard, safeRoute, json } from '@/server/api';
import { env } from '@/server/env';
import { finishCalendarConsent } from '@/features/calendar/connection';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    const params = new URL(request.url).searchParams;
    const jar = await cookies();
    const state = params.get('state');
    if (!state || state.length > 100 || state !== jar.get('lifeos-calendar-state')?.value)
      return json({ error: 'invalid_oauth_state' }, 400);
    jar.set('lifeos-calendar-state', '', {
      path: '/api/calendar/google/callback',
      maxAge: 0,
      httpOnly: true,
      secure: env.AUTH_URL.startsWith('https:'),
      sameSite: 'lax',
    });
    let result = 'cancelled';
    const code = params.get('code');
    if (!params.has('error') && code && code.length <= 4096) {
      try {
        await finishCalendarConsent(guard.userId, state, code);
        result = 'connected';
      } catch {
        result = 'failed';
      }
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(`/settings?calendar=${result}#account`, env.AUTH_URL).toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  });
