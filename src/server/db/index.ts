import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '@/server/env';
import * as schema from './schema';
const globalDb = globalThis as unknown as { lifeosPool?: Pool };
export const pool =
  globalDb.lifeosPool ??
  new Pool({ connectionString: env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
if (process.env.NODE_ENV !== 'production') globalDb.lifeosPool = pool;
export const db = drizzle(pool, { schema });
