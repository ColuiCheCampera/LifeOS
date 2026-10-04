import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, gt, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import {
  calendarChannels as channels,
  calendarSources as sources,
  calendarConnections as connections,
  auditLogs,
} from '@/server/db/schema';
import { tokenHash } from '@/server/security/policy';
import { calendarClient } from './connection';
import { providerRetry } from './provider-schema';

// Caller holds the source advisory lock. Provisioning failures never stop polling.
export async function ensureWatch(
  source: typeof sources.$inferSelect,
  access: { accessToken: string; version: number },
  address: string,
) {
  if (source.watchNextRun.getTime() > Date.now()) return;
  const id = uuidv7();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 86400000);
  await db.insert(channels).values({
    id,
    userId: source.userId,
    sourceId: source.id,
    connectionVersion: access.version,
    tokenHash: tokenHash(token),
    expiresAt,
  });
  try {
    const remote = await calendarClient().watch(access.accessToken, source.remoteId, {
      id,
      token,
      address,
      expiration: expiresAt.getTime(),
    });
    if (remote.id !== id || remote.expiration <= Date.now() + 60000)
      throw new Error('invalid_channel');
    const expiration = new Date(Math.min(remote.expiration, expiresAt.getTime()));
    const old = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(sources)
        .where(and(eq(sources.userId, source.userId), eq(sources.id, source.id)))
        .for('update');
      const [connection] = await tx
        .select()
        .from(connections)
        .where(eq(connections.userId, source.userId));
      if (
        !current?.enabled ||
        current.version !== source.version ||
        connection?.status !== 'connected' ||
        connection.version !== access.version
      )
        throw new Error('channel_superseded');
      const previous = await tx
        .select()
        .from(channels)
        .where(
          and(
            eq(channels.userId, source.userId),
            eq(channels.sourceId, source.id),
            eq(channels.status, 'active'),
          ),
        );
      await tx
        .update(channels)
        .set({ status: 'retired', updatedAt: new Date(), version: sql`${channels.version}+1` })
        .where(
          and(
            eq(channels.userId, source.userId),
            eq(channels.sourceId, source.id),
            inArray(channels.status, ['active', 'failed']),
          ),
        );
      await tx
        .update(channels)
        .set({
          status: 'active',
          resourceId: remote.resourceId,
          expiresAt: expiration,
          updatedAt: new Date(),
          version: 2,
        })
        .where(eq(channels.id, id));
      await tx
        .update(sources)
        .set({
          watchError: null,
          watchNextRun: new Date(Math.max(Date.now() + 60000, expiration.getTime() - 3600000)),
        })
        .where(eq(sources.id, source.id));
      await tx.insert(auditLogs).values({
        userId: source.userId,
        entityType: 'calendar_channel',
        entityId: id,
        action: 'calendar.watch_started',
      });
      return previous;
    });
    for (const previous of old) {
      if (!previous.resourceId) continue;
      try {
        await calendarClient().stopWatch(access.accessToken, previous.id, previous.resourceId);
      } catch {
        /* Retired channels cannot schedule work and expire at Google. */
      }
    }
  } catch {
    await db.transaction(async (tx) => {
      // Keep the same source-before-channel lock order as notification handling.
      await tx
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.id, source.id), eq(sources.userId, source.userId)))
        .for('update');
      await tx
        .update(channels)
        .set({ status: 'failed', updatedAt: new Date(), version: sql`${channels.version}+1` })
        .where(eq(channels.id, id));
      const [failed] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(channels)
        .where(
          and(
            eq(channels.userId, source.userId),
            eq(channels.sourceId, source.id),
            eq(channels.status, 'failed'),
            gt(channels.expiresAt, new Date()),
          ),
        );
      await tx
        .update(sources)
        .set({
          watchError: 'watch_failed',
          watchNextRun: new Date(Date.now() + providerRetry(Math.max(0, failed.count - 1))),
        })
        .where(
          and(
            eq(sources.id, source.id),
            eq(sources.userId, source.userId),
            eq(sources.version, source.version),
          ),
        );
    });
  }
}

const notification = z.object({
  id: z.uuid(),
  token: z.string().regex(/^[\w-]{43}$/),
  resource: z.string().min(1).max(1024),
  state: z.enum(['sync', 'exists', 'not_exists']),
  message: z.string().regex(/^[1-9][0-9]{0,19}$/),
});
export async function receiveNotification(headers: Headers) {
  const parsed = notification.safeParse({
    id: headers.get('x-goog-channel-id'),
    token: headers.get('x-goog-channel-token'),
    resource: headers.get('x-goog-resource-id'),
    state: headers.get('x-goog-resource-state'),
    message: headers.get('x-goog-message-number'),
  });
  if (!parsed.success) return false;
  const data = parsed.data;
  return db.transaction(async (tx) => {
    // Source first, matching provisioning's lock order; channel ID is only a lookup key.
    const [hint] = await tx
      .select({ sourceId: channels.sourceId, userId: channels.userId })
      .from(channels)
      .where(eq(channels.id, data.id));
    if (!hint) return false;
    const [source] = await tx
      .select()
      .from(sources)
      .where(and(eq(sources.id, hint.sourceId), eq(sources.userId, hint.userId)))
      .for('update');
    const [channel] = await tx
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.id, data.id),
          eq(channels.userId, hint.userId),
          gt(channels.expiresAt, new Date()),
        ),
      )
      .for('update');
    if (
      !source?.enabled ||
      !channel ||
      !['active', 'pending'].includes(channel.status) ||
      !timingSafeEqual(Buffer.from(channel.tokenHash), Buffer.from(tokenHash(data.token)))
    )
      return false;
    const [connection] = await tx
      .select()
      .from(connections)
      .where(eq(connections.userId, hint.userId));
    if (connection?.status !== 'connected' || connection.version !== channel.connectionVersion)
      return false;
    // The initial sync may precede Google's response. Never trust its resource ID to bind a channel.
    if (channel.status === 'pending') return data.state === 'sync';
    if (channel.resourceId !== data.resource) return false;
    if (BigInt(data.message) <= BigInt(channel.lastMessage)) return true;
    await tx
      .update(channels)
      .set({
        lastMessage: data.message,
        updatedAt: new Date(),
        version: sql`${channels.version}+1`,
      })
      .where(eq(channels.id, channel.id));
    await tx
      .update(sources)
      .set({
        notificationVersion: sql`${sources.notificationVersion}+1`,
        nextRun: source.failures ? source.nextRun : new Date(),
      })
      .where(and(eq(sources.id, source.id), eq(sources.userId, hint.userId)));
    await tx.insert(auditLogs).values({
      userId: hint.userId,
      entityType: 'calendar_channel',
      entityId: channel.id,
      action: 'calendar.notified',
    });
    return true;
  });
}
