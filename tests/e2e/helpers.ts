import type { Page } from '@playwright/test';
import { Pool } from 'pg';
import { testEnv } from '../env';

// Each scenario exercises the real limiter with its own fresh counters.
export async function resetRateLimits() {
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  try {
    await pool.query('DELETE FROM rate_limits');
  } finally {
    await pool.end();
  }
}
// Calendar scenarios share only the disposable test cluster, never provider state.
export async function resetCalendarFixtures() {
  const url = new URL(testEnv.DATABASE_URL);
  if (url.port !== '55439') throw new Error('Refusing calendar fixture cleanup outside test DB');
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  try {
    await pool.query('DELETE FROM calendar_bindings');
    await pool.query('DELETE FROM calendar_sources');
    await pool.query('DELETE FROM calendar_events');
    await pool.query('DELETE FROM calendar_connections');
  } finally {
    await pool.end();
  }
}
export async function login(page: Page, mode = 'allowed') {
  const csrf = await (await page.request.get('http://localhost:4011/api/auth/csrf')).json();
  const response = await page.request.post('http://localhost:4011/api/auth/signin/google', {
    form: { csrfToken: csrf.csrfToken, callbackUrl: 'http://localhost:3100/today' },
    headers: { 'X-Auth-Return-Redirect': '1' },
  });
  const { url } = await response.json();
  const target = new URL(url);
  target.searchParams.set('test_profile', mode);
  await page.goto(target.href);
}
