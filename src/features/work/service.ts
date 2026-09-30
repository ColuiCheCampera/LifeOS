import 'server-only';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import {
  tasks,
  projects,
  areas,
  milestones,
  savedFilters,
  settings,
  mutationReceipts,
  auditLogs,
  calendarEvents,
  calendarSources,
  calendarBindings,
} from '@/server/db/schema';
import { getSettings } from '@/features/settings/service';
import { tokenHash } from '@/server/security/policy';
import { applyWork } from './domain';
import { kindSchema, type Kind, type WorkRecord, type WorkMutation } from './schema';
import { eventSchema } from '@/features/calendar/schema';
import { sameShared, sharedEvent } from '@/features/calendar/provider-schema';
const tables = {
  event: calendarEvents,
  task: tasks,
  project: projects,
  area: areas,
  milestone: milestones,
  filter: savedFilters,
};
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function read(tx: Transaction, userId: string) {
  const records: WorkRecord[] = [];
  for (const [kind, table] of Object.entries(tables)) {
    const rows = await tx.select().from(table).where(eq(table.userId, userId));
    records.push(
      ...rows.map((r) => ({
        id: r.id,
        kind: kindSchema.parse(kind),
        data: r.data,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        deletedAt: r.deletedAt?.toISOString() ?? null,
        version: r.version,
        clocks: r.fieldClocks,
      })),
    );
  }
  const bindings = await tx
    .select({ binding: calendarBindings, source: calendarSources })
    .from(calendarBindings)
    .innerJoin(
      calendarSources,
      and(eq(calendarBindings.sourceId, calendarSources.id), eq(calendarSources.userId, userId)),
    )
    .where(eq(calendarBindings.userId, userId));
  for (const { binding, source } of bindings) {
    const event = records.find((r) => r.kind === 'event' && r.id === binding.eventId);
    if (!event) continue;
    const local = event.deletedAt ? null : sharedEvent(eventSchema.parse(event.data));
    event.calendar = {
      sourceId: source.id,
      name: source.name,
      color: source.color,
      readOnly:
        !['owner', 'writer'].includes(source.role) ||
        binding.state === 'unsupported' ||
        !!binding.remote?.attendees?.length,
      state:
        binding.state === 'synced' && !sameShared(local, binding.base) ? 'pending' : binding.state,
      canRestore: binding.remote?.status !== 'cancelled',
      meetUrl: binding.remote?.hangoutLink?.startsWith('https://meet.google.com/')
        ? binding.remote.hangoutLink
        : null,
    };
  }
  return records;
}
export async function getWork(userId: string) {
  await getSettings(userId);
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.userId, userId)).for('update');
    return { revision: s.workRevision, records: await read(tx, userId) };
  });
}
export async function mutateWork(userId: string, mutation: WorkMutation) {
  await getSettings(userId);
  const hash = tokenHash(
    JSON.stringify({
      ...mutation,
      patch: Object.fromEntries(
        Object.entries(mutation.patch).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }),
  );
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(settings).where(eq(settings.userId, userId)).for('update');
    const [receipt] = await tx
      .select()
      .from(mutationReceipts)
      .where(
        and(eq(mutationReceipts.userId, userId), eq(mutationReceipts.mutationId, mutation.id)),
      );
    if (receipt)
      return receipt.payloadHash === hash
        ? { result: receipt.result }
        : { error: 'mutation_id_reused' };
    if (mutation.at > Date.now() + 300000) return { error: 'clock_skew' };
    const before = await read(tx, userId);
    const original = before.find((r) => r.id === mutation.recordId);
    if (original?.calendar?.readOnly) return { error: 'calendar_read_only' };
    if (original?.calendar && mutation.patch.recurrence)
      return { error: 'google_recurrence_unsupported' };
    if (original?.calendar && mutation.operation === 'restore' && !original.calendar.canRestore)
      return { error: 'google_deleted_copy_required' };
    if (
      mutation.operation === 'restore' &&
      original?.deletedAt &&
      Date.now() - Date.parse(original.deletedAt) > 30 * 86400000
    )
      return { error: 'trash_expired' };
    let result;
    try {
      result = applyWork({ revision: s.workRevision, records: before }, mutation);
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'invalid_mutation' };
    }
    const changed = result.snapshot.records.filter(
      (r) => !before.some((previous) => previous.id === r.id && previous.version === r.version),
    );
    for (const r of changed) {
      const previous = before.find((item) => item.id === r.id);
      if (previous && previous.version === r.version) continue;
      const table = tables[r.kind as Kind];
      const values = {
        id: r.id,
        userId,
        data: r.data,
        fieldClocks: r.clocks,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
        deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
        version: r.version,
      };
      if (previous)
        await tx
          .update(table)
          .set(values)
          .where(and(eq(table.userId, userId), eq(table.id, r.id)));
      else {
        const existing = await tx.select({ id: table.id }).from(table).where(eq(table.id, r.id));
        if (existing.length) throw new Error('record_id_collision');
        await tx.insert(table).values(values);
      }
    }
    await tx
      .update(settings)
      .set({ workRevision: result.snapshot.revision })
      .where(eq(settings.userId, userId));
    const ack = {
      mutationId: mutation.id,
      conflicts: result.conflicts,
      snapshot: { revision: result.snapshot.revision, records: changed },
    };
    await tx
      .insert(mutationReceipts)
      .values({ userId, mutationId: mutation.id, payloadHash: hash, result: ack });
    await tx.insert(auditLogs).values({
      userId,
      action: 'work.' + mutation.operation,
      entityType: mutation.kind,
      entityId: mutation.recordId,
      details: { fields: Object.keys(mutation.patch), conflicts: result.conflicts },
    });
    return { result: ack };
  });
}
export async function searchWork(userId: string, query: string) {
  return db
    .select({ id: tasks.id, data: tasks.data })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        sql`${tasks.deletedAt} IS NULL`,
        sql`to_tsvector('simple', coalesce(${tasks.data}->>'title','') || ' ' || coalesce(${tasks.data}->>'notes','')) @@ plainto_tsquery('simple',${query})`,
      ),
    )
    .limit(100);
}
