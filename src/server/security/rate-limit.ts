import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { tokenHash } from './policy';
import { v7 as uuidv7 } from 'uuid';
export async function rateLimit(key: string, limit: number, windowSeconds = 60) {
  const now = new Date();
  const start = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const result = await db.execute<{ hits: number }>(
    sql`INSERT INTO rate_limits (id,user_id,bucket,window_start,hits) VALUES (${uuidv7()},'00000000-0000-7000-8000-000000000000',${tokenHash(key)},${start},1) ON CONFLICT (bucket) DO UPDATE SET hits=CASE WHEN rate_limits.window_start=${start} THEN rate_limits.hits+1 ELSE 1 END,window_start=${start},updated_at=now(),version=rate_limits.version+1 RETURNING hits`,
  );
  return result.rows[0].hits <= limit;
}
