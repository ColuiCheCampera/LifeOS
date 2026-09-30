// Isolated provider transport for the test service process only; never imported by the app.
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { testEnv } from './env';
import { calendarRemote, calendarRemoteHandlers } from './calendar-remote';
export const calendarProvider = setupServer(
  http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
    const body = new URLSearchParams(await request.text());
    const mode =
      body.get('code') ?? body.get('refresh_token')?.replace('refresh-', '') ?? 'allowed';
    if (mode === 'revoked') return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 });
    return HttpResponse.json({
      access_token: mode,
      refresh_token: `refresh-${mode}`,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid email profile https://www.googleapis.com/auth/calendar',
    });
  }),
  http.get('https://openidconnect.googleapis.com/v1/userinfo', ({ request }) =>
    HttpResponse.json({
      sub:
        request.headers.get('authorization') === 'Bearer denied'
          ? 'someone-else'
          : testEnv.ALLOWED_GOOGLE_SUB,
      email: testEnv.ALLOWED_EMAIL,
      email_verified: true,
    }),
  ),
  http.get('https://www.googleapis.com/calendar/v3/users/me/calendarList', () =>
    HttpResponse.json({
      items: [
        {
          id: 'test-calendar',
          summary: '<script>Test calendar</script>',
          accessRole: calendarRemote.role,
          backgroundColor: '#28533d',
          timeZone: 'Europe/Rome',
        },
      ],
    }),
  ),
  ...calendarRemoteHandlers,
);
