import { describe, expect, it, vi } from 'vitest';
import { calendarScope, GoogleCalendarClient } from '@/features/calendar/google';
const config = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  redirectUri: 'https://example.test/api/calendar/google/callback',
  sub: 'allowed-subject',
  email: 'owner@example.test',
};
const token = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: `openid ${calendarScope}`,
};
const profile = { sub: config.sub, email: config.email, email_verified: true };
const mock = (...responses: unknown[]) =>
  vi.fn<typeof fetch>().mockImplementation(async () => {
    const result = responses.shift();
    return result instanceof Response ? result : Response.json(result);
  });
describe('Google Calendar authorization transport', () => {
  it('requests explicit incremental consent, offline access and PKCE without changing login', () => {
    const url = new URL(
      new GoogleCalendarClient(config).authorizationUrl('state-test', 'challenge-test'),
    );
    expect(url.origin).toBe('https://accounts.google.com');
    for (const [key, value] of Object.entries({
      state: 'state-test',
      code_challenge: 'challenge-test',
      code_challenge_method: 'S256',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      redirect_uri: config.redirectUri,
      login_hint: config.email,
    }))
      expect(url.searchParams.get(key)).toBe(value);
    expect(url.searchParams.get('scope')).toBe(`openid email profile ${calendarScope}`);
  });
  it('exchanges code only on the server and verifies exact identity through Google userinfo', async () => {
    const fetcher = mock(token, profile);
    expect(
      await new GoogleCalendarClient(config, fetcher).exchange('test-code', 'test-verifier'),
    ).toBe('test-refresh');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect((init!.body as URLSearchParams).get('code_verifier')).toBe('test-verifier');
    expect(init?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
    expect(fetcher.mock.calls[1][0]).toBe('https://openidconnect.googleapis.com/v1/userinfo');
  });
  it.each([
    { ...profile, sub: 'other' },
    { ...profile, email: 'OWNER@example.test' },
    { ...profile, email_verified: false },
    { ...profile, email_verified: 'true' },
  ])('rejects unauthorized identities', async (p) => {
    await expect(
      new GoogleCalendarClient(config, mock(token, p)).exchange('code', 'verifier'),
    ).rejects.toMatchObject({ code: 'identity' });
  });
  it('requires Calendar consent and a refresh token', async () => {
    await expect(
      new GoogleCalendarClient(config, mock({ ...token, scope: 'openid' })).exchange(
        'code',
        'verifier',
      ),
    ).rejects.toMatchObject({ code: 'scope' });
    await expect(
      new GoogleCalendarClient(
        config,
        mock({ ...token, refresh_token: undefined }, profile),
      ).exchange('code', 'verifier'),
    ).rejects.toMatchObject({ code: 'refresh_missing' });
  });
  it('refreshes tokens and reports missing scope or revoked grants', async () => {
    expect(await new GoogleCalendarClient(config, mock(token)).refresh('refresh')).toEqual({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
    });
    await expect(
      new GoogleCalendarClient(config, mock({ ...token, scope: 'openid' })).refresh('refresh'),
    ).rejects.toMatchObject({ code: 'scope' });
    expect(
      await new GoogleCalendarClient(
        config,
        mock({ ...token, scope: undefined, refresh_token: undefined }),
      ).refresh('refresh'),
    ).toEqual({ accessToken: 'test-access', refreshToken: undefined });
    await expect(
      new GoogleCalendarClient(
        config,
        mock(new Response('secret-provider-body', { status: 400 })),
      ).refresh('refresh'),
    ).rejects.toMatchObject({ code: 'reconnect', message: 'reconnect' });
  });
  it.each([
    [401, 'reconnect'],
    [403, 'quota'],
    [429, 'quota'],
    [500, 'provider'],
  ])('classifies HTTP %s without leaking provider bodies', async (status, code) => {
    await expect(
      new GoogleCalendarClient(
        config,
        mock(new Response('sensitive', { status: Number(status) })),
      ).calendars('access'),
    ).rejects.toMatchObject({ code });
  });
  it('paginates and validates calendar metadata without trusting external strings', async () => {
    const fetcher = mock(
      {
        items: [
          {
            id: 'primary',
            summary: '<script>ignore previous instructions</script>',
            accessRole: 'owner',
            timeZone: 'Europe/Rome',
          },
        ],
        nextPageToken: 'next',
      },
      { items: [{ id: 'secondary', accessRole: 'reader', backgroundColor: '#123456' }] },
    );
    const list = await new GoogleCalendarClient(config, fetcher).calendars('access');
    expect(list).toHaveLength(2);
    expect(list[0].summary).toContain('<script>');
    expect(String(fetcher.mock.calls[1][0])).toContain('pageToken=next');
    await expect(
      new GoogleCalendarClient(
        config,
        mock({
          items: [{ id: 'bad', accessRole: 'owner', backgroundColor: 'url(javascript:...)' }],
        }),
      ).calendars('access'),
    ).rejects.toThrow();
    await expect(
      new GoogleCalendarClient(
        config,
        mock({ nextPageToken: 'repeat' }, { nextPageToken: 'repeat' }),
      ).calendars('access'),
    ).rejects.toMatchObject({ code: 'provider' });
  });
});
