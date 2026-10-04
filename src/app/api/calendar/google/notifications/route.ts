import { safeRoute } from '@/server/api';
import { receiveNotification } from '@/features/calendar/watch';
import { rateLimit } from '@/server/security/rate-limit';

// Provider callback: a bound per-channel secret replaces browser session/Origin authentication.
// No body, resource URL or user-provided event data is used to update calendar contents.
export const POST = (request: Request) =>
  safeRoute(async () => {
    if (!(await rateLimit('calendar-notifications', 600)))
      return new Response(null, { status: 429, headers: { 'Cache-Control': 'no-store' } });
    return new Response(null, {
      status: (await receiveNotification(request.headers)) ? 204 : 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  });
