import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { users, settings } from '../src/server/db/schema';
import { defaultPreferences } from '../src/features/settings/schema';
import { v7 as uuidv7 } from 'uuid';
async function main() {
  if (process.env.DEMO_MODE !== 'true') throw new Error('Seed requires explicit DEMO_MODE=true');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const db = drizzle(pool);
    const id = uuidv7();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ id, userId: id, email: 'demo@example.test', name: 'Persona demo' })
        .onConflictDoNothing()
        .returning();
      if (row)
        await tx.insert(settings).values({ userId: row.id, preferences: defaultPreferences });
    });
    console.log('Demo records seeded. No authentication bypass created.');
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
