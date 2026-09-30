import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { login, resetRateLimits, resetCalendarFixtures } from './helpers';
import { testEnv } from '../env';
import type { WorkRecord } from '../../src/features/work/schema';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(resetRateLimits);
test.beforeEach(resetCalendarFixtures);

test('Google sync survives replay, merges offline edits and exposes conflicts without overwrites', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  expect((await request.get('/api/calendar/sync')).status()).toBe(401);
  expect((await request.post('/api/calendar/sync', { data: { action: 'sync' } })).status()).toBe(
    401,
  );
  await login(page);
  const headers = { Origin: testEnv.AUTH_URL };
  expect(
    (
      await page.request.post('/api/calendar/sync', {
        headers: { Origin: 'https://attacker.test' },
        data: { action: 'sync' },
      })
    ).status(),
  ).toBe(403);
  const harness = (data: Record<string, unknown>) =>
    page.request.post('http://localhost:4011/calendar-harness', { data });
  const remote = async (operation: string, event?: Record<string, unknown>) =>
    (await (await harness({ action: 'remote', operation, event })).json()) as {
      events: Record<string, unknown>[];
    };
  const start = await (
    await page.request.post('/api/calendar/google', { headers, data: { action: 'connect' } })
  ).json();
  const state = new URL(start.url).searchParams.get('state');
  expect((await harness({ action: 'finish', state, code: 'allowed' })).status()).toBe(200);
  await remote('reset');
  expect((await harness({ action: 'configure' })).status()).toBe(200);
  const status = async () => await (await page.request.get('/api/calendar/sync')).json();
  const sourceId = (await status()).sources[0].id as string;
  const sync = () => harness({ action: 'sync', sourceId });
  const records = async () =>
    (await (await page.request.get('/api/work')).json()).records as WorkRecord[];
  const mutate = (recordId: string, patch: Record<string, unknown>, operation = 'upsert') =>
    page.request.post('/api/work', {
      headers,
      data: {
        id: randomUUID(),
        clientId: randomUUID(),
        kind: 'event',
        recordId,
        patch,
        operation,
        at: Date.now() + 5,
      },
    });
  const command = (data: Record<string, unknown>) =>
    page.request.post('/api/calendar/sync', { headers, data });
  const period = {
    start: { dateTime: '2026-10-20T09:00:00+02:00', timeZone: 'Europe/Rome' },
    end: { dateTime: '2026-10-20T10:00:00+02:00' },
  };
  await remote('set', {
    id: 'remote-native',
    summary: 'Google QA original',
    description: 'Original notes',
    ...period,
    hangoutLink: 'https://meet.google.com/test-qa',
  });
  await remote('set', {
    id: 'remote-all-day',
    summary: 'Google QA all day',
    start: { date: '2026-10-21' },
    end: { date: '2026-10-22' },
  });
  await remote('set', {
    id: 'remote-series',
    summary: 'Unsupported series',
    ...period,
    recurrence: ['RRULE:FREQ=WEEKLY'],
  });
  await remote('fault', { pageSize: 1 });
  expect((await command({ action: 'sync' })).status()).toBe(202);
  expect((await harness({ action: 'jobs' })).status()).toBe(200);
  const first = (await records()).find((r) => r.data.title === 'Google QA original')!;
  expect(first.data.schedule).toMatchObject({
    start: '2026-10-20T07:00:00Z',
    end: '2026-10-20T08:00:00Z',
  });
  expect(first.calendar).toMatchObject({
    readOnly: false,
    state: 'synced',
    meetUrl: 'https://meet.google.com/test-qa',
  });
  expect((await status()).sources[0].unsupported).toBe(1);
  expect((await records()).some((r) => r.data.title === 'Unsupported series')).toBe(false);
  await page.goto('/calendar');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.getByLabel('Data', { exact: true }).fill('2026-10-20');
  await page.getByLabel('Vista', { exact: true }).selectOption('day');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page
    .locator('.calendar-event')
    .filter({ hasText: 'Google QA original' })
    .locator('.calendar-event-open')
    .click();
  const dialog = page.getByRole('dialog', { name: 'Evento', exact: true });
  await expect(dialog.getByLabel('Ricorrenza RRULE', { exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Note', exact: true }).fill('Offline local notes');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await remote('set', { id: 'remote-native', summary: 'Google QA remote title' });
  expect((await sync()).status()).toBe(200);
  let current = (await records()).find((r) => r.id === first.id)!;
  expect(current.data).toMatchObject({
    title: 'Google QA remote title',
    notes: 'Offline local notes',
  });
  expect((await remote('inspect')).events.find((e) => e.id === 'remote-native')).toMatchObject({
    summary: 'Google QA remote title',
    description: 'Offline local notes',
  });
  expect((await mutate(first.id, { title: 'LifeOS conflicting title' })).status()).toBe(200);
  await remote('set', { id: 'remote-native', summary: 'Google conflicting title' });
  expect((await sync()).status()).toBe(200);
  current = (await records()).find((r) => r.id === first.id)!;
  expect(current.calendar?.state).toBe('conflict');
  const staleConflict = (await status()).conflicts[0];
  await remote('set', { id: 'remote-native', description: 'New remote conflict preview' });
  expect((await sync()).status()).toBe(200);
  expect(
    (
      await command({
        action: 'resolve',
        eventId: first.id,
        version: current.version,
        bindingVersion: staleConflict.bindingVersion,
        keepCopy: false,
      })
    ).status(),
  ).toBe(409);
  expect(current.data.title).toBe('LifeOS conflicting title');
  await page.reload();
  await page.locator('.calendar-provider summary').click();
  const conflict = page.locator('.calendar-conflict-card');
  await expect(conflict).toContainText('LifeOS conflicting title');
  await expect(conflict).toContainText('Google conflicting title');
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/calendar-google-mobile.png', fullPage: true });
  await conflict
    .getByRole('button', { name: 'Conserva copia locale e usa Google', exact: true })
    .click();
  await expect(conflict).toHaveCount(0);
  expect(
    (await records()).some((r) => r.data.title === 'LifeOS conflicting title' && !r.calendar),
  ).toBe(true);
  expect((await records()).find((r) => r.id === first.id)?.data.title).toBe(
    'Google conflicting title',
  );
  expect((await mutate(first.id, { title: 'LifeOS race' })).status()).toBe(200);
  await remote('fault', { raceWrite: true });
  expect((await sync()).status()).toBe(409);
  expect((await remote('inspect')).events.find((e) => e.id === 'remote-native')?.summary).toBe(
    'Google concurrent change',
  );
  expect((await sync()).status()).toBe(200);
  current = (await records()).find((r) => r.id === first.id)!;
  expect(current.calendar?.state).toBe('conflict');
  expect(
    (
      await command({
        action: 'resolve',
        eventId: first.id,
        version: current.version,
        bindingVersion: (await status()).conflicts[0].bindingVersion,
        keepCopy: false,
      })
    ).status(),
  ).toBe(202);
  expect((await mutate(first.id, { notes: 'Preserve against deletion' })).status()).toBe(200);
  await remote('set', { id: 'remote-native', status: 'cancelled' });
  expect((await sync()).status()).toBe(200);
  current = (await records()).find((r) => r.id === first.id)!;
  expect(current.calendar?.state).toBe('conflict');
  expect(
    (
      await command({
        action: 'resolve',
        eventId: first.id,
        version: current.version,
        bindingVersion: (await status()).conflicts[0].bindingVersion,
        keepCopy: true,
      })
    ).status(),
  ).toBe(202);
  expect((await records()).find((r) => r.id === first.id)?.deletedAt).not.toBeNull();
  expect((await mutate(first.id, {}, 'restore')).status()).toBe(409);
  const localId = randomUUID();
  expect(
    (
      await mutate(localId, {
        title: 'Published QA local',
        schedule: {
          start: '2026-10-22T09:00:00Z',
          end: '2026-10-22T10:00:00Z',
          allDay: false,
          timezone: 'Europe/Rome',
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await command({ action: 'attach', sourceId: randomUUID(), eventId: localId, version: 1 })
    ).status(),
  ).toBe(409);
  expect(
    (await command({ action: 'attach', sourceId, eventId: localId, version: 99 })).status(),
  ).toBe(409);
  for (let i = 0; i < 2; i++)
    expect(
      (await command({ action: 'attach', sourceId, eventId: localId, version: 1 })).status(),
    ).toBe(202);
  await remote('fault', { failWriteAfter: true });
  expect((await sync()).status()).toBe(409);
  expect((await sync()).status()).toBe(200);
  const remoteId = 'lifeos' + localId.replaceAll('-', '');
  expect((await remote('inspect')).events.filter((e) => e.id === remoteId)).toHaveLength(1);
  expect((await records()).filter((r) => r.id === localId)).toHaveLength(1);
  expect((await mutate(localId, { title: 'Pending through 410' })).status()).toBe(200);
  await remote('fault', { expire: true });
  expect((await sync()).status()).toBe(200);
  expect((await remote('inspect')).events.find((e) => e.id === remoteId)?.summary).toBe(
    'Pending through 410',
  );
  await remote('remove', { id: 'remote-all-day' });
  await remote('fault', { expire: true });
  expect((await sync()).status()).toBe(200);
  expect(
    (await records()).find((r) => r.data.title === 'Google QA all day')?.deletedAt,
  ).not.toBeNull();
  await remote('fault', { role: 'reader' });
  expect((await sync()).status()).toBe(200);
  expect((await mutate(localId, { title: 'Must not write read-only calendar' })).status()).toBe(
    409,
  );
  await remote('fault', { role: 'owner' });
  await remote('set', { id: remoteId, attendees: [{ email: 'guest@example.test' }] });
  expect((await sync()).status()).toBe(200);
  expect((await mutate(localId, { title: 'Must not write guests' })).status()).toBe(409);
  await remote('fault', { quota: true });
  expect((await sync()).status()).toBe(409);
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  try {
    const row = (
      await pool.query('SELECT error,next_run,sync_token FROM calendar_sources WHERE id=$1', [
        sourceId,
      ])
    ).rows[0];
    expect(row.error).toBe('quota');
    expect(new Date(row.next_run).getTime()).toBeGreaterThan(Date.now());
    expect(row.sync_token).toMatch(/^sync-/);
    expect(JSON.stringify(await status())).not.toContain(row.sync_token);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM calendar_bindings WHERE event_id=$1', [
          localId,
        ])
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await pool.end();
  }
  await remote('fault', { quota: false });
  await remote('set', { id: remoteId, attendees: [] });
  expect((await sync()).status()).toBe(200);
  expect((await mutate(localId, {}, 'delete')).status()).toBe(200);
  expect((await sync()).status()).toBe(200);
  expect((await remote('inspect')).events.find((e) => e.id === remoteId)?.status).toBe('cancelled');
  expect((await sync()).status()).toBe(200);
  expect(
    (await command({ action: 'configure', remoteId: 'test-calendar', enabled: false })).status(),
  ).toBe(202);
  await remote('set', { id: 'paused-event', summary: 'Not imported while paused', ...period });
  expect((await harness({ action: 'jobs' })).status()).toBe(200);
  expect((await status()).sources[0].enabled).toBe(false);
  expect((await records()).some((r) => r.data.title === 'Not imported while paused')).toBe(false);
});
