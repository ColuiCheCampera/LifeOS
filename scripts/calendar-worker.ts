import { config } from 'dotenv';
import { setTimeout } from 'node:timers/promises';
config({ path: '.env.local', quiet: true });
async function main() {
  const { runCalendarJobs } = await import('../src/features/calendar/sync-service');
  const { pool } = await import('../src/server/db');
  let stopped = false;
  process.once('SIGINT', () => {
    stopped = true;
  });
  process.once('SIGTERM', () => {
    stopped = true;
  });
  try {
    while (!stopped) {
      try {
        await runCalendarJobs();
      } catch {
        console.error('Calendar worker: database unavailable; retrying.');
      }
      if (!stopped) await setTimeout(5000);
    }
  } finally {
    await pool.end();
  }
}
void main().catch(() => {
  console.error('Calendar worker failed to start. Check server configuration.');
  process.exitCode = 1;
});
