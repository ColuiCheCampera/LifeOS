import 'server-only';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { settings, mutationReceipts, auditLogs } from '@/server/db/schema';
import { getSettings } from '@/features/settings/service';
import { snapshotSchema, type SettingsMutation } from './schema';
import { reconcile } from './reconcile';
import { tokenHash } from '@/server/security/policy';
export async function getSnapshot(userId: string) {
  await getSettings(userId);
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  return snapshotSchema.parse({
    preferences: row.preferences,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    clocks: row.fieldClocks,
  });
}
export async function applyMutation(userId: string, mutation: SettingsMutation) {
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
    const [row] = await tx.select().from(settings).where(eq(settings.userId, userId)).for('update');
    const [receipt] = await tx
      .select()
      .from(mutationReceipts)
      .where(
        and(eq(mutationReceipts.userId, userId), eq(mutationReceipts.mutationId, mutation.id)),
      );
    if (receipt)
      return receipt.payloadHash === hash
        ? { result: receipt.result }
        : { error: 'mutation_id_reused' as const };
    if (mutation.at > Date.now() + 300000) return { error: 'clock_skew' as const };
    const merged = reconcile(row.preferences, row.fieldClocks, mutation);
    const [updated] = merged.changed
      ? await tx
          .update(settings)
          .set({
            preferences: merged.preferences,
            fieldClocks: merged.clocks,
            version: sql`${settings.version}+1`,
            updatedAt: new Date(),
          })
          .where(eq(settings.id, row.id))
          .returning()
      : [row];
    const result = {
      mutationId: mutation.id,
      conflicts: merged.conflicts,
      snapshot: snapshotSchema.parse({
        preferences: updated.preferences,
        clocks: updated.fieldClocks,
        version: updated.version,
        updatedAt: updated.updatedAt.toISOString(),
      }),
    };
    await tx
      .insert(mutationReceipts)
      .values({ userId, mutationId: mutation.id, payloadHash: hash, result });
    await tx.insert(auditLogs).values({
      userId,
      action: 'sync.settings.applied',
      entityType: 'settings',
      entityId: row.id,
      details: {
        mutationId: mutation.id,
        fields: Object.keys(mutation.patch),
        conflicts: merged.conflicts,
        version: updated.version,
      },
    });
    return { result };
  });
}
