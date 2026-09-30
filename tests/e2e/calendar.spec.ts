import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { login, resetRateLimits, resetCalendarFixtures } from './helpers';
import { testEnv } from '../env';
test.beforeEach(resetRateLimits);
test.beforeEach(resetCalendarFixtures);
const headers = { Origin: testEnv.AUTH_URL };

test('calendar offline creation, conflicts, timeblocking, restore and replay', async ({ page }) => {
  await login(page);
  const taskId = randomUUID();
  expect(
    (
      await page.request.post('/api/work', {
        headers,
        data: {
          id: randomUUID(),
          clientId: randomUUID(),
          recordId: taskId,
          kind: 'task',
          at: Date.now(),
          operation: 'upsert',
          patch: { title: 'Calendar QA focus', estimate: 45 },
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto('/calendar');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.getByLabel('Data', { exact: true }).fill('2026-10-20');
  await page.getByLabel('Vista', { exact: true }).selectOption('day');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Nuovo evento', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Evento', exact: true });
  await dialog.getByLabel('Titolo', { exact: true }).fill('Calendar QA locale');
  await dialog.getByLabel('Inizio', { exact: true }).fill('2026-10-20T09:00');
  await dialog
    .getByLabel('Fine (esclusa per eventi giornalieri)', { exact: true })
    .fill('2026-10-20T10:00');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.calendar-event')).toContainText('Calendar QA locale');
  const task = page
    .locator('.calendar-task')
    .filter({ has: page.locator('strong', { hasText: 'Calendar QA focus' }) });
  await task.getByRole('button', { name: 'Trova spazio', exact: true }).click();
  await expect(dialog.getByLabel('Inizio', { exact: true })).toHaveValue('2026-10-20T10:00');
  await expect(dialog.getByLabel('Attività collegata', { exact: true })).toHaveValue(taskId);
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const block = page.locator('.calendar-event').filter({ hasText: 'Calendar QA focus' });
  await expect(block).toContainText('10:00–10:45');
  await block.getByRole('button').click();
  await dialog.getByLabel('Inizio', { exact: true }).fill('2026-10-20T09:30');
  await expect(dialog).toContainText('Questo orario si sovrappone');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(block).toContainText('Sovrapposizione');
  await block.getByRole('button').click();
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(block).toHaveCount(0);
  await page.getByRole('button', { name: 'Cestino eventi', exact: true }).click();
  await page.getByRole('button', { name: 'Ripristina', exact: true }).click();
  await expect(block).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'work/calendar-mobile.png', fullPage: true });
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.reload();
  const records = (await (await page.request.get('/api/work')).json()).records as {
    kind: string;
    data: Record<string, unknown>;
  }[];
  expect(records.filter((r) => r.kind === 'event' && r.data.taskId === taskId)).toHaveLength(1);
  expect(
    records.find((r) => r.kind === 'event' && r.data.taskId === taskId)?.data.schedule,
  ).toMatchObject({ start: '2026-10-20T07:30:00Z', end: '2026-10-20T08:45:00Z' });
  const legacy = await (await page.request.get('/api/sync?work=1')).json();
  expect(legacy.work.records.some((r: { kind: string }) => r.kind === 'event')).toBe(false);
  const expanded = await (await page.request.get('/api/sync?work=1&calendar=1')).json();
  expect(expanded.work.records.some((r: { kind: string }) => r.kind === 'event')).toBe(true);
});

test('calendar endpoints enforce auth and CSRF; consent state is bound, expiring and one-use', async ({
  page,
  request,
}) => {
  for (const path of ['/api/calendar/google', '/api/calendar/google/callback?state=bad&code=bad'])
    expect((await request.get(path)).status()).toBe(401);
  expect(
    (await request.post('/api/calendar/google', { headers, data: { action: 'connect' } })).status(),
  ).toBe(401);
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  expect(
    (
      await page.request.post('/api/calendar/google', {
        headers: { Origin: 'https://attacker.test' },
        data: { action: 'connect' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post('/api/calendar/google', { headers, data: { action: 'bad' } })
    ).status(),
  ).toBe(400);
  const begin = async () => {
    const response = await page.request.post('/api/calendar/google', {
      headers,
      data: { action: 'connect' },
    });
    expect(response.status()).toBe(200);
    const url = new URL((await response.json()).url);
    expect(url.searchParams.get('scope')).toBe(
      'openid email profile https://www.googleapis.com/auth/calendar',
    );
    const cookie = (await page.context().cookies()).find((c) => c.name === 'lifeos-calendar-state');
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/api/calendar/google/callback',
      value: url.searchParams.get('state'),
    });
    return url.searchParams.get('state')!;
  };
  const harness = (state: string, code: string, action = 'finish') =>
    page.request.post('http://localhost:4011/calendar-harness', { data: { state, code, action } });
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  try {
    const state = await begin();
    expect(
      (await page.request.get('/api/calendar/google/callback?state=wrong&code=bad')).status(),
    ).toBe(400);
    const stored = (await pool.query('SELECT * FROM calendar_connections')).rows[0];
    expect(stored.state_hash).not.toBe(state);
    expect(stored.verifier_cipher).toMatch(/^v1\./);
    expect((await harness(state, 'denied')).status()).toBe(409);
    expect(
      (await pool.query('SELECT refresh_cipher FROM calendar_connections')).rows[0].refresh_cipher,
    ).toBeNull();
    expect((await harness(state, 'allowed')).status()).toBe(409);
    const expired = await begin();
    await pool.query("UPDATE calendar_connections SET state_expires=now()-interval '1 minute'");
    expect((await harness(expired, 'allowed')).status()).toBe(409);
    const allowed = await begin();
    expect((await harness(allowed, 'allowed')).status()).toBe(200);
    expect((await harness(allowed, 'allowed')).status()).toBe(409);
    expect((await (await page.request.get('/api/calendar/google')).json()).status).toBe(
      'connected',
    );
    const encrypted = (await pool.query('SELECT refresh_cipher FROM calendar_connections')).rows[0]
      .refresh_cipher;
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('refresh-allowed');
    const list = await (await harness('', '', 'calendars')).json();
    expect(list.calendars[0].summary).toBe('<script>Test calendar</script>');
    expect(
      JSON.stringify(await (await page.request.get('/api/sync?work=1&calendar=1')).json()),
    ).not.toContain(encrypted);
    await page.goto('/settings');
    await expect(page.getByRole('region', { name: 'Google Calendar', exact: true })).toContainText(
      'Account collegato',
    );
    const cancelled = await begin();
    const callback = await page.request.get(
      `/api/calendar/google/callback?state=${cancelled}&error=access_denied`,
      { maxRedirects: 0 },
    );
    expect(callback.status()).toBe(303);
    expect(callback.headers().location).toContain('calendar=cancelled');
    expect(
      (
        await page.request.get(`/api/calendar/google/callback?state=${cancelled}&code=unused`, {
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post('/api/calendar/google', { headers, data: { action: 'disconnect' } })
      ).status(),
    ).toBe(200);
    const clean = (await pool.query('SELECT * FROM calendar_connections')).rows[0];
    expect(clean).toMatchObject({
      refresh_cipher: null,
      verifier_cipher: null,
      state_hash: null,
      status: 'disconnected',
    });
    expect((await harness(cancelled, 'allowed')).status()).toBe(409);
  } finally {
    await pool.end();
  }
});
