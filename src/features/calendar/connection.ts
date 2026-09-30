import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { calendarConnections as connections, auditLogs } from '@/server/db/schema';
import { env } from '@/server/env';
import { encryptSecret, decryptSecret, tokenHash } from '@/server/security/policy';
import { GoogleCalendarClient, GoogleError } from './google';
const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
export const calendarClient = () =>
  new GoogleCalendarClient({
    clientId: env.AUTH_GOOGLE_ID,
    clientSecret: env.AUTH_GOOGLE_SECRET,
    redirectUri: new URL('/api/calendar/google/callback', env.AUTH_URL).toString(),
    sub: env.ALLOWED_GOOGLE_SUB,
    email: env.ALLOWED_EMAIL,
  });
const cipher = (value: string, userId: string, purpose: string) =>
  encryptSecret(value, key, `calendar:${userId}:${purpose}`);
const decipher = (value: string, userId: string, purpose: string) =>
  decryptSecret(value, key, `calendar:${userId}:${purpose}`);

export async function startCalendarConsent(userId: string) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  await db.transaction(async (tx) => {
    await tx
      .insert(connections)
      .values({
        userId,
        stateHash: tokenHash(state),
        verifierCipher: cipher(verifier, userId, 'pkce'),
        stateExpires: new Date(Date.now() + 600000),
      })
      .onConflictDoUpdate({
        target: connections.userId,
        set: {
          stateHash: tokenHash(state),
          verifierCipher: cipher(verifier, userId, 'pkce'),
          stateExpires: new Date(Date.now() + 600000),
          updatedAt: new Date(),
          version: sql`${connections.version}+1`,
        },
      });
    await tx
      .insert(auditLogs)
      .values({ userId, entityType: 'calendar_connection', action: 'calendar.consent_started' });
  });
  return {
    state,
    url: calendarClient().authorizationUrl(
      state,
      createHash('sha256').update(verifier).digest('base64url'),
    ),
  };
}
export async function finishCalendarConsent(userId: string, state: string, code: string) {
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, userId),
          eq(connections.stateHash, tokenHash(state)),
          gt(connections.stateExpires, new Date()),
        ),
      )
      .for('update');
    if (!row?.verifierCipher) throw new Error('invalid_oauth_state');
    await tx
      .update(connections)
      .set({ stateHash: null, verifierCipher: null, stateExpires: null })
      .where(eq(connections.id, row.id));
    return row;
  });
  const refreshToken = await calendarClient().exchange(
    code,
    decipher(claimed.verifierCipher!, userId, 'pkce'),
  );
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(connections)
      .set({
        refreshCipher: cipher(refreshToken, userId, 'refresh'),
        status: 'connected',
        updatedAt: new Date(),
        version: sql`${connections.version}+1`,
      })
      .where(and(eq(connections.userId, userId), eq(connections.version, claimed.version)))
      .returning({ id: connections.id });
    if (!rows.length) throw new Error('oauth_superseded');
    await tx
      .insert(auditLogs)
      .values({ userId, entityType: 'calendar_connection', action: 'calendar.connected' });
  });
}
export async function calendarConnection(userId: string) {
  const [row] = await db
    .select({ status: connections.status })
    .from(connections)
    .where(eq(connections.userId, userId));
  return { status: row?.status ?? 'disconnected' };
}
export async function calendarAccess(userId: string) {
  const [row] = await db.select().from(connections).where(eq(connections.userId, userId));
  if (!row?.refreshCipher || row.status !== 'connected') throw new GoogleError('reconnect');
  try {
    const tokens = await calendarClient().refresh(decipher(row.refreshCipher, userId, 'refresh'));
    if (tokens.refreshToken)
      await db
        .update(connections)
        .set({
          refreshCipher: cipher(tokens.refreshToken, userId, 'refresh'),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connections.userId, userId),
            eq(connections.version, row.version),
            eq(connections.refreshCipher, row.refreshCipher),
          ),
        );
    // A disconnect while the provider request was in flight must not expose its result.
    const [current] = await db
      .select({ version: connections.version, status: connections.status })
      .from(connections)
      .where(eq(connections.userId, userId));
    if (!current || current.version !== row.version || current.status !== 'connected')
      throw new GoogleError('reconnect');
    return { accessToken: tokens.accessToken, version: row.version };
  } catch (error) {
    if (error instanceof GoogleError && ['reconnect', 'scope'].includes(error.code))
      await db
        .update(connections)
        .set({ status: 'reconnect', updatedAt: new Date() })
        .where(and(eq(connections.userId, userId), eq(connections.version, row.version)));
    throw error;
  }
}
export async function listGoogleCalendars(userId: string) {
  const access = await calendarAccess(userId);
  const calendars = await calendarClient().calendars(access.accessToken);
  const [row] = await db.select().from(connections).where(eq(connections.userId, userId));
  if (row?.version !== access.version || row.status !== 'connected')
    throw new GoogleError('reconnect');
  return calendars;
}
export async function disconnectCalendar(userId: string) {
  // Forget Calendar credentials locally. Revoking Google's combined grant would also revoke identity access.
  await db.transaction(async (tx) => {
    await tx
      .update(connections)
      .set({
        refreshCipher: null,
        status: 'disconnected',
        stateHash: null,
        verifierCipher: null,
        stateExpires: null,
        updatedAt: new Date(),
        version: sql`${connections.version}+1`,
      })
      .where(eq(connections.userId, userId));
    await tx
      .insert(auditLogs)
      .values({ userId, entityType: 'calendar_connection', action: 'calendar.disconnected' });
  });
}
