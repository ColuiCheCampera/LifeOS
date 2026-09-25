import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/server/db';
import { sessions, auditLogs } from '@/server/db/schema';
import { apiGuard, json, safeRoute } from '@/server/api';
import { getSettings } from '@/features/settings/service';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    const { preferences } = await getSettings(guard.userId);
    const rows = await db
      .select({
        id: sessions.id,
        device: sessions.device,
        createdAt: sessions.createdAt,
        lastSeen: sessions.lastSeen,
        expires: sessions.expires,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, guard.userId),
          gt(sessions.expires, new Date()),
          gt(sessions.lastSeen, new Date(Date.now() - preferences.idleMinutes * 60000)),
          gt(sessions.createdAt, new Date(Date.now() - preferences.absoluteDays * 86400000)),
        ),
      );
    return json(rows);
  });
export const DELETE = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request, true);
    if (guard.response) return guard.response;
    await db.transaction(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.userId, guard.userId));
      await tx.insert(auditLogs).values({
        userId: guard.userId,
        action: 'sessions.revoked_all',
        entityType: 'session',
        details: {},
      });
    });
    return json({ ok: true });
  });
