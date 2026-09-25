import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { apiGuard, json, safeRoute } from '@/server/api';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    await db.execute(sql`select 1`);
    return json({ status: 'ok', version: '0.1.0' });
  });
