import 'server-only';
import { z } from 'zod';
import { isAllowedProfile } from '@/server/security/policy';

export const calendarScope = 'https://www.googleapis.com/auth/calendar';
const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((v) => v.toLowerCase() === 'bearer'),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
export const googleCalendarSchema = z.object({
  id: z.string().min(1).max(1024),
  summary: z.string().max(1000).default(''),
  backgroundColor: z
    .string()
    .regex(/^#[\da-fA-F]{6}$/)
    .default('#28533d'),
  accessRole: z.enum(['freeBusyReader', 'reader', 'writer', 'owner']),
  primary: z.boolean().optional(),
  timeZone: z.string().max(80).optional(),
});
export type GoogleCalendar = z.infer<typeof googleCalendarSchema>;
export class GoogleError extends Error {
  constructor(
    public readonly code:
      'reconnect' | 'quota' | 'provider' | 'identity' | 'scope' | 'refresh_missing',
  ) {
    super(code);
  }
}
type Transport = typeof fetch;
export class GoogleCalendarClient {
  constructor(
    private readonly config: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      sub: string;
      email: string;
    },
    private readonly request: Transport = fetch,
  ) {}
  authorizationUrl(state: string, challenge: string) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: `openid email profile ${calendarScope}`,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      login_hint: this.config.email,
    }).toString();
    return url.toString();
  }
  private async json(url: string, init: RequestInit) {
    const response = await this.request(url, {
      ...init,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // Provider bodies may contain credentials or external text. Never forward or log them.
      if (response.status === 401 || response.status === 400) throw new GoogleError('reconnect');
      if (response.status === 429 || response.status === 403) throw new GoogleError('quota');
      throw new GoogleError('provider');
    }
    return response.json() as Promise<unknown>;
  }
  private async tokens(values: Record<string, string>) {
    return tokenSchema.parse(
      await this.json('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...values,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      }),
    );
  }
  async exchange(code: string, verifier: string) {
    const token = await this.tokens({
      code,
      code_verifier: verifier,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });
    if (!token.scope?.split(' ').includes(calendarScope)) throw new GoogleError('scope');
    const profile = await this.json('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!isAllowedProfile(profile, this.config)) throw new GoogleError('identity');
    if (!token.refresh_token) throw new GoogleError('refresh_missing');
    return token.refresh_token;
  }
  async refresh(refreshToken: string) {
    const token = await this.tokens({ refresh_token: refreshToken, grant_type: 'refresh_token' });
    if (token.scope && !token.scope.split(' ').includes(calendarScope))
      throw new GoogleError('scope');
    return { accessToken: token.access_token, refreshToken: token.refresh_token };
  }
  async calendars(accessToken: string) {
    const calendars: GoogleCalendar[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ maxResults: '250', showHidden: 'true' });
      if (pageToken) query.set('pageToken', pageToken);
      const page = z
        .object({
          items: z.array(googleCalendarSchema).max(250).default([]),
          nextPageToken: z.string().max(4096).optional(),
        })
        .parse(
          await this.json(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${query}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
        );
      calendars.push(...page.items);
      pageToken = page.nextPageToken;
      if (pageToken && (seen.has(pageToken) || seen.size >= 40)) throw new GoogleError('provider');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return calendars;
  }
}
