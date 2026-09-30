import 'server-only';
import { and, eq, sql, lte } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { db, pool } from '@/server/db';
import {
  calendarSources as sources,
  calendarBindings as bindings,
  calendarEvents as events,
  calendarConnections as connections,
  settings,
  auditLogs,
} from '@/server/db/schema';
import { calendarAccess, calendarClient, listGoogleCalendars } from './connection';
import { GoogleError } from './google';
import { eventSchema, type CalendarEvent } from './schema';
import {
  googleBody,
  mergeProvider,
  providerData,
  providerRetry,
  sameShared,
  sameValue,
  sharedEvent,
  type ProviderEvent,
} from './provider-schema';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = typeof sources.$inferSelect;
type EventRow = typeof events.$inferSelect;

async function lockWork(tx: Transaction, userId: string) {
  const [row] = await tx.select().from(settings).where(eq(settings.userId, userId)).for('update');
  if (!row) throw new Error('missing_user_settings');
}
async function active(tx: Transaction, source: Source, connectionVersion: number) {
  const [connection] = await tx
    .select()
    .from(connections)
    .where(eq(connections.userId, source.userId));
  const [current] = await tx
    .select()
    .from(sources)
    .where(and(eq(sources.userId, source.userId), eq(sources.id, source.id)));
  if (
    connection?.status !== 'connected' ||
    connection.version !== connectionVersion ||
    !current?.enabled ||
    current.version !== source.version
  )
    throw new Error('sync_superseded');
}
async function saveEvent(
  tx: Transaction,
  userId: string,
  previous: EventRow | undefined,
  data: CalendarEvent | null,
  remoteAt = Date.now(),
) {
  if (!previous && !data) return null;
  const id = previous?.id ?? uuidv7();
  const deletedAt = data ? null : (previous?.deletedAt ?? new Date());
  const payload = data ?? previous!.data;
  const changed =
    !previous || !sameValue(previous.data, payload) || !!previous.deletedAt !== !!deletedAt;
  if (!changed) return previous!;
  const at = Math.min(remoteAt, Date.now() + 300000);
  const clocks = { ...previous?.fieldClocks };
  for (const field of [...Object.keys(payload), 'deletedAt']) {
    const before = field === 'deletedAt' ? !!previous?.deletedAt : previous?.data[field];
    const after = field === 'deletedAt' ? !!deletedAt : payload[field as keyof typeof payload];
    if (!sameValue(before, after))
      clocks[field] = { at: Math.max(at, clocks[field]?.at ?? 0), clientId: 'google-calendar' };
  }
  const values = {
    id,
    userId,
    data: payload,
    fieldClocks: clocks,
    deletedAt,
    version: (previous?.version ?? 0) + 1,
    updatedAt: new Date(),
  };
  const [saved] = previous
    ? await tx
        .update(events)
        .set(values)
        .where(and(eq(events.userId, userId), eq(events.id, id)))
        .returning()
    : await tx.insert(events).values(values).returning();
  await tx
    .update(settings)
    .set({ workRevision: sql`${settings.workRevision}+1` })
    .where(eq(settings.userId, userId));
  await tx.insert(auditLogs).values({
    userId,
    entityType: 'event',
    entityId: id,
    action: 'calendar.reconcile',
    details: { deleted: !!deletedAt },
  });
  return saved;
}
async function incoming(source: Source, raw: ProviderEvent, connectionVersion: number) {
  await db.transaction(async (tx) => {
    await lockWork(tx, source.userId);
    await active(tx, source, connectionVersion);
    const [binding] = await tx
      .select()
      .from(bindings)
      .where(
        and(
          eq(bindings.userId, source.userId),
          eq(bindings.sourceId, source.id),
          eq(bindings.remoteId, raw.id),
        ),
      );
    if (binding?.etag && binding.etag === raw.etag && binding.state !== 'conflict') return;
    const [local] = binding?.eventId
      ? await tx
          .select()
          .from(events)
          .where(and(eq(events.userId, source.userId), eq(events.id, binding.eventId)))
      : [];
    const mapped = providerData(raw, source.timezone);
    const unsupported = raw.status !== 'cancelled' && (!mapped || !raw.etag);
    const remote = mapped ? sharedEvent(mapped) : null;
    const localData = local && !local.deletedAt ? eventSchema.parse(local.data) : null;
    const merged = unsupported
      ? { data: null, conflicts: [] }
      : mergeProvider(binding?.base ?? null, localData ? sharedEvent(localData) : null, remote);
    let eventId: string | null = local?.id ?? null;
    if (!unsupported && !merged.conflicts.length) {
      const data = merged.data
        ? eventSchema.parse({
            ...(local ? local.data : mapped),
            ...merged.data,
            ...(local ? {} : { color: source.color }),
          })
        : null;
      const saved = await saveEvent(
        tx,
        source.userId,
        local,
        data,
        raw.updated ? Date.parse(raw.updated) : Date.now(),
      );
      eventId = saved?.id ?? null;
    }
    const value = {
      eventId,
      etag: raw.etag || null,
      remote: raw,
      base: unsupported || merged.conflicts.length ? (binding?.base ?? null) : remote,
      state: unsupported ? 'unsupported' : merged.conflicts.length ? 'conflict' : 'synced',
      updatedAt: new Date(),
    };
    if (binding)
      await tx
        .update(bindings)
        .set({ ...value, version: binding.version + 1 })
        .where(and(eq(bindings.userId, source.userId), eq(bindings.id, binding.id)));
    else
      await tx
        .insert(bindings)
        .values({ ...value, userId: source.userId, sourceId: source.id, remoteId: raw.id });
  });
}
async function outgoing(
  source: Source,
  bindingId: string,
  accessToken: string,
  connectionVersion: number,
) {
  // The short per-event transaction serializes local writes with conditional provider writes.
  // A crash after the HTTP response is recovered by deterministic IDs and the next pull.
  await db.transaction(async (tx) => {
    await lockWork(tx, source.userId);
    await active(tx, source, connectionVersion);
    const [binding] = await tx
      .select()
      .from(bindings)
      .where(and(eq(bindings.userId, source.userId), eq(bindings.id, bindingId)));
    if (
      !binding?.eventId ||
      ['conflict', 'unsupported'].includes(binding.state) ||
      !['owner', 'writer'].includes(source.role) ||
      binding.remote?.attendees?.length
    )
      return;
    const [local] = await tx
      .select()
      .from(events)
      .where(and(eq(events.userId, source.userId), eq(events.id, binding.eventId)));
    if (!local) return;
    const data = local.deletedAt ? null : eventSchema.parse(local.data);
    const shared = data ? sharedEvent(data) : null;
    if (sameShared(shared, binding.base)) return;
    if (data?.recurrence) throw new Error('unsupported_recurrence');
    const api = calendarClient();
    let remote: ProviderEvent;
    if (!data) {
      if (binding.etag) {
        try {
          await api.deleteEvent(accessToken, source.remoteId, binding.remoteId, binding.etag);
        } catch (error) {
          if (!(error instanceof GoogleError) || !['gone', 'not_found'].includes(error.code))
            throw error;
        }
      }
      remote = {
        id: binding.remoteId,
        etag: binding.etag ?? '',
        status: 'cancelled',
        updated: new Date().toISOString(),
      };
    } else {
      const body = {
        ...googleBody(data),
        ...(!binding.etag
          ? {
              extendedProperties: { private: { lifeosEventId: local.id } },
              reminders: {
                useDefault: false,
                overrides: data.reminders.map((minutes) => ({ method: 'popup', minutes })),
              },
            }
          : {}),
      };
      try {
        remote = await api.writeEvent(
          accessToken,
          source.remoteId,
          binding.remoteId,
          body,
          binding.etag,
        );
      } catch (error) {
        if (!(error instanceof GoogleError) || error.code !== 'exists' || binding.etag) throw error;
        remote = await api.event(accessToken, source.remoteId, binding.remoteId);
        const mapped = providerData(remote, source.timezone);
        if (
          remote.extendedProperties?.private?.lifeosEventId !== local.id ||
          !mapped ||
          !sameShared(shared, sharedEvent(mapped))
        ) {
          await tx
            .update(bindings)
            .set({ remote, state: 'conflict', updatedAt: new Date(), version: binding.version + 1 })
            .where(eq(bindings.id, binding.id));
          return;
        }
      }
    }
    await tx
      .update(bindings)
      .set({
        etag: remote.etag || binding.etag,
        remote,
        base: shared,
        state: 'synced',
        updatedAt: new Date(),
        version: binding.version + 1,
      })
      .where(and(eq(bindings.userId, source.userId), eq(bindings.id, binding.id)));
    await tx.insert(auditLogs).values({
      userId: source.userId,
      entityType: 'event',
      entityId: local.id,
      action: data ? 'calendar.export' : 'calendar.export_delete',
    });
  });
}

export async function configureSource(userId: string, remoteId: string, enabled: boolean) {
  if (!enabled) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(sources)
        .set({ enabled: false, updatedAt: new Date(), version: sql`${sources.version}+1` })
        .where(and(eq(sources.userId, userId), eq(sources.remoteId, remoteId)))
        .returning({ id: sources.id });
      if (!rows.length) throw new Error('calendar_not_available');
      await tx.insert(auditLogs).values({
        userId,
        entityType: 'calendar_source',
        entityId: rows[0].id,
        action: 'calendar.pause',
      });
    });
    return;
  }
  const calendar = (await listGoogleCalendars(userId)).find((c) => c.id === remoteId);
  if (!calendar || calendar.accessRole === 'freeBusyReader')
    throw new Error('calendar_not_available');
  await db.transaction(async (tx) => {
    await tx
      .insert(sources)
      .values({
        userId,
        remoteId,
        name: calendar.summary || calendar.id,
        role: calendar.accessRole,
        timezone: calendar.timeZone ?? 'Europe/Rome',
        color: calendar.backgroundColor,
        enabled,
      })
      .onConflictDoUpdate({
        target: [sources.userId, sources.remoteId],
        set: {
          enabled,
          name: calendar.summary || calendar.id,
          role: calendar.accessRole,
          timezone: calendar.timeZone ?? 'Europe/Rome',
          color: calendar.backgroundColor,
          nextRun: new Date(),
          updatedAt: new Date(),
          version: sql`${sources.version}+1`,
        },
      });
    await tx.insert(auditLogs).values({
      userId,
      entityType: 'calendar_source',
      action: enabled ? 'calendar.enable' : 'calendar.pause',
    });
  });
}
export async function attachEvent(
  userId: string,
  sourceId: string,
  eventId: string,
  version: number,
) {
  await db.transaction(async (tx) => {
    await lockWork(tx, userId);
    const [source] = await tx
      .select()
      .from(sources)
      .where(and(eq(sources.userId, userId), eq(sources.id, sourceId)));
    const [event] = await tx
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.id, eventId)));
    if (
      !source?.enabled ||
      !['owner', 'writer'].includes(source.role) ||
      !event ||
      event.deletedAt ||
      event.version !== version ||
      eventSchema.parse(event.data).recurrence
    )
      throw new Error('event_not_publishable');
    const [bound] = await tx
      .select()
      .from(bindings)
      .where(and(eq(bindings.userId, userId), eq(bindings.eventId, eventId)));
    if (bound) {
      if (bound.sourceId === sourceId) return;
      throw new Error('event_already_linked');
    }
    await tx.insert(bindings).values({
      userId,
      sourceId,
      eventId,
      remoteId: 'lifeos' + eventId.replaceAll('-', ''),
      state: 'pending',
    });
    await tx.update(sources).set({ nextRun: new Date() }).where(eq(sources.id, sourceId));
    await tx
      .insert(auditLogs)
      .values({ userId, entityType: 'event', entityId: eventId, action: 'calendar.link' });
  });
}
export async function resolveConflict(
  userId: string,
  eventId: string,
  version: number,
  bindingVersion: number,
  keepCopy: boolean,
) {
  await db.transaction(async (tx) => {
    await lockWork(tx, userId);
    const [event] = await tx
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.id, eventId)));
    const [binding] = await tx
      .select()
      .from(bindings)
      .where(and(eq(bindings.userId, userId), eq(bindings.eventId, eventId)));
    const [source] = binding
      ? await tx
          .select()
          .from(sources)
          .where(and(eq(sources.userId, userId), eq(sources.id, binding.sourceId)))
      : [];
    if (
      !event ||
      event.version !== version ||
      binding?.state !== 'conflict' ||
      binding.version !== bindingVersion ||
      !binding.remote ||
      !source
    )
      throw new Error('conflict_changed');
    const remote = providerData(binding.remote, source.timezone);
    if (!remote && binding.remote.status !== 'cancelled') throw new Error('unsupported_event');
    if (keepCopy && !event.deletedAt)
      await saveEvent(tx, userId, undefined, eventSchema.parse(event.data));
    await saveEvent(
      tx,
      userId,
      event,
      remote ? eventSchema.parse({ ...event.data, ...sharedEvent(remote) }) : null,
    );
    await tx
      .update(bindings)
      .set({
        base: remote ? sharedEvent(remote) : null,
        etag: binding.remote.etag || null,
        state: 'synced',
        updatedAt: new Date(),
        version: binding.version + 1,
      })
      .where(eq(bindings.id, binding.id));
    await tx.insert(auditLogs).values({
      userId,
      entityType: 'event',
      entityId: eventId,
      action: 'calendar.resolve',
      details: { keepCopy },
    });
  });
}
export async function syncStatus(userId: string) {
  const calendars = await db
    .select({
      id: sources.id,
      remoteId: sources.remoteId,
      name: sources.name,
      color: sources.color,
      role: sources.role,
      enabled: sources.enabled,
      lastSynced: sources.lastSynced,
      nextRun: sources.nextRun,
      error: sources.error,
    })
    .from(sources)
    .where(eq(sources.userId, userId));
  const mirrors = await db
    .select({ sourceId: bindings.sourceId, state: bindings.state })
    .from(bindings)
    .where(eq(bindings.userId, userId));
  const conflicts = await db
    .select({
      eventId: events.id,
      version: events.version,
      bindingVersion: bindings.version,
      local: events.data,
      deletedAt: events.deletedAt,
      remote: bindings.remote,
      timezone: sources.timezone,
    })
    .from(bindings)
    .innerJoin(events, and(eq(bindings.eventId, events.id), eq(events.userId, userId)))
    .innerJoin(sources, and(eq(bindings.sourceId, sources.id), eq(sources.userId, userId)))
    .where(and(eq(bindings.userId, userId), eq(bindings.state, 'conflict')));
  return {
    sources: calendars.map((c) => ({
      ...c,
      unsupported: mirrors.filter((b) => b.sourceId === c.id && b.state === 'unsupported').length,
      conflicts: mirrors.filter((b) => b.sourceId === c.id && b.state === 'conflict').length,
    })),
    conflicts: conflicts.map((c) => ({
      eventId: c.eventId,
      version: c.version,
      bindingVersion: c.bindingVersion,
      local: c.deletedAt ? null : eventSchema.parse(c.local),
      remote: c.remote ? providerData(c.remote, c.timezone) : null,
    })),
  };
}
export async function requestSync(userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(sources)
      .set({ nextRun: new Date() })
      .where(and(eq(sources.userId, userId), eq(sources.enabled, true)));
    await tx
      .insert(auditLogs)
      .values({ userId, entityType: 'calendar_source', action: 'calendar.sync_requested' });
  });
}
export async function syncSource(userId: string, sourceId: string) {
  const lease = await pool.connect();
  const lock = `calendar:${userId}:${sourceId}`;
  try {
    const locked = await lease.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
      [lock],
    );
    if (!locked.rows[0].locked) return;
    let [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.userId, userId), eq(sources.id, sourceId), eq(sources.enabled, true)));
    if (!source) return;
    try {
      const access = await calendarAccess(userId);
      const api = calendarClient();
      const calendar = (await api.calendars(access.accessToken)).find(
        (c) => c.id === source.remoteId,
      );
      if (!calendar || calendar.accessRole === 'freeBusyReader')
        throw new Error('calendar_not_available');
      source = {
        ...source,
        role: calendar.accessRole,
        name: calendar.summary || calendar.id,
        color: calendar.backgroundColor,
        timezone: calendar.timeZone ?? source.timezone,
      };
      await db
        .update(sources)
        .set({
          role: source.role,
          name: source.name,
          color: source.color,
          timezone: source.timezone,
        })
        .where(and(eq(sources.id, source.id), eq(sources.version, source.version)));
      let full = !source.syncToken;
      let batch;
      try {
        batch = await api.events(access.accessToken, source.remoteId, source.syncToken);
      } catch (error) {
        if (!(error instanceof GoogleError) || error.code !== 'gone') throw error;
        full = true;
        batch = await api.events(access.accessToken, source.remoteId);
      }
      for (const event of batch.events) await incoming(source, event, access.version);
      if (full) {
        const seen = new Set(batch.events.map((e) => e.id));
        const existing = await db
          .select()
          .from(bindings)
          .where(and(eq(bindings.userId, userId), eq(bindings.sourceId, source.id)));
        for (const binding of existing)
          if (
            binding.remote &&
            !seen.has(binding.remoteId) &&
            binding.remote.status !== 'cancelled'
          )
            await incoming(
              source,
              {
                id: binding.remoteId,
                etag: '',
                status: 'cancelled',
                updated: new Date().toISOString(),
              },
              access.version,
            );
      }
      await db.transaction(async (tx) => {
        await active(tx, source, access.version);
        await tx
          .update(sources)
          .set({ syncToken: batch.syncToken })
          .where(and(eq(sources.id, source.id), eq(sources.version, source.version)));
      });
      const pending = await db
        .select({ id: bindings.id })
        .from(bindings)
        .where(and(eq(bindings.userId, userId), eq(bindings.sourceId, source.id)));
      for (const binding of pending)
        await outgoing(source, binding.id, access.accessToken, access.version);
      await db
        .update(sources)
        .set({
          lastSynced: new Date(),
          nextRun: new Date(Date.now() + 60000),
          failures: 0,
          error: null,
        })
        .where(and(eq(sources.id, source.id), eq(sources.version, source.version)));
    } catch (error) {
      const code = error instanceof GoogleError ? error.code : 'sync_failed';
      await db
        .update(sources)
        .set({
          error: code,
          failures: source.failures + 1,
          nextRun: new Date(Date.now() + providerRetry(source.failures)),
        })
        .where(and(eq(sources.id, source.id), eq(sources.version, source.version)));
      throw new Error(code);
    }
  } finally {
    try {
      await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
    } finally {
      lease.release();
    }
  }
}
export async function runCalendarJobs() {
  const due = await db
    .select({ id: sources.id, userId: sources.userId })
    .from(sources)
    .innerJoin(connections, eq(sources.userId, connections.userId))
    .where(
      and(
        eq(sources.enabled, true),
        lte(sources.nextRun, new Date()),
        eq(connections.status, 'connected'),
      ),
    )
    .limit(20);
  for (const source of due) {
    try {
      await syncSource(source.userId, source.id);
    } catch {
      /* Persisted error and retry deadline are the worker result. */
    }
  }
}
