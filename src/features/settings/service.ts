import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { settings, auditLogs } from '@/server/db/schema';
import { defaultPreferences, preferencesSchema, type Preferences } from './schema';
export async function getSettings(userId: string) {
  await db
    .insert(settings)
    .values({ userId, preferences: defaultPreferences })
    .onConflictDoNothing();
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  return { preferences: preferencesSchema.parse(row.preferences), version: row.version };
}
export async function updateSettings(userId: string, preferences: Preferences, version: number) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .for('update');
    if (!existing || existing.version !== version) return null;
    const fieldClocks = { ...existing.fieldClocks };
    for (const field of Object.keys(preferences) as (keyof Preferences)[]) {
      if (preferences[field] !== existing.preferences[field])
        fieldClocks[field] = {
          at: Math.max(Date.now(), (fieldClocks[field]?.at ?? 0) + 1),
          clientId: 'server',
        };
    }
    const [row] = await tx
      .update(settings)
      .set({ preferences, fieldClocks, version: sql`${settings.version}+1`, updatedAt: new Date() })
      .where(and(eq(settings.userId, userId), eq(settings.version, version)))
      .returning();
    if (!row) return null;
    await tx.insert(auditLogs).values({
      userId,
      action: 'settings.updated',
      entityType: 'settings',
      entityId: row.id,
      details: { version: row.version },
    });
    return { preferences: row.preferences, version: row.version };
  });
}
