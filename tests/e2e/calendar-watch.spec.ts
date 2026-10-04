import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { login, resetCalendarFixtures, resetRateLimits } from './helpers';
import { testEnv } from '../env';

test.beforeEach(resetRateLimits);
test.beforeEach(resetCalendarFixtures);
test('Google watch authenticates callbacks, renews channels and retains polling recovery', async ({
  page,
  request,
}) => {
  const endpoint = '/api/calendar/google/notifications';
  expect((await request.post(endpoint)).status()).toBe(404);
  await login(page);
  const headers = { Origin: testEnv.AUTH_URL };
  const harness = (data: Record<string, unknown>) =>
    page.request.post('http://localhost:4011/calendar-harness', { data });
  const remote = async (operation: string, event?: Record<string, unknown>) =>
    await (await harness({ action: 'remote', operation, event })).json();
  const start = await (
    await page.request.post('/api/calendar/google', { headers, data: { action: 'connect' } })
  ).json();
  expect(
    (
      await harness({
        action: 'finish',
        state: new URL(start.url).searchParams.get('state'),
        code: 'allowed',
      })
    ).status(),
  ).toBe(200);
  await remote('reset');
  expect((await harness({ action: 'configure' })).status()).toBe(200);
  const status = async () => await (await page.request.get('/api/calendar/sync')).json();
  const sourceId = (await status()).sources[0].id;
  const watch = () => harness({ action: 'watch', sourceId });
  const sync = () => harness({ action: 'sync', sourceId });
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  const source = async () =>
    (await pool.query('SELECT * FROM calendar_sources WHERE id=$1', [sourceId])).rows[0];
  type Channel = { id: string; token: string; resourceId: string };
  const notify = (channel: Channel, message = '2', extra: Record<string, string> = {}) =>
    request.post(endpoint, {
      headers: {
        'x-goog-channel-id': channel.id,
        'x-goog-channel-token': channel.token,
        'x-goog-resource-id': channel.resourceId,
        'x-goog-resource-state': 'exists',
        'x-goog-message-number': message,
        ...extra,
      },
    });
  try {
    expect((await watch()).status()).toBe(200);
    const first = (await remote('inspect')).watches[0];
    expect(first.earlyStatus).toBe(204);
    expect(first.address).toBe('https://app.example.test/api/calendar/google/notifications');
    const stored = (await pool.query('SELECT * FROM calendar_channels WHERE id=$1', [first.id]))
      .rows[0];
    expect(stored.token_hash).not.toBe(first.token);
    expect(stored.status).toBe('active');
    expect(JSON.stringify(await status())).not.toContain(first.token);
    expect((await status()).sources[0].pushExpiresAt).toBeTruthy();
    expect((await watch()).status()).toBe(200);
    expect((await remote('inspect')).watches).toHaveLength(1);
    const invalidHeaders: Record<string, string>[] = [
      { 'x-goog-channel-token': 'x'.repeat(43) },
      { 'x-goog-resource-id': 'wrong' },
      { 'x-goog-channel-id': randomUUID() },
      { 'x-goog-message-number': '-1' },
      { 'x-goog-resource-state': 'invalid' },
    ];
    for (const extra of invalidHeaders)
      expect((await notify(first, '2', extra)).status()).toBe(404);
    const before = (await source()).notification_version;
    await remote('set', {
      id: 'push-event',
      summary: 'Imported after push',
      start: { date: '2026-10-10' },
      end: { date: '2026-10-11' },
    });
    expect((await notify(first)).status()).toBe(204);
    expect((await source()).notification_version).toBe(before + 1);
    expect((await notify(first)).status()).toBe(204);
    expect((await notify(first, '1')).status()).toBe(204);
    expect((await source()).notification_version).toBe(before + 1);
    expect((await harness({ action: 'jobs' })).status()).toBe(200);
    const work = await (await page.request.get('/api/work')).json();
    expect(
      work.records.some(
        (r: { data: { title?: string } }) => r.data.title === 'Imported after push',
      ),
    ).toBe(true);
    await remote('fault', { notifyDuringPull: true });
    expect((await sync()).status()).toBe(200);
    expect(new Date((await source()).next_run).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await sync()).status()).toBe(200);
    await pool.query('UPDATE calendar_sources SET watch_next_run=now() WHERE id=$1', [sourceId]);
    await remote('fault', { watchFail: true });
    expect((await watch()).status()).toBe(200);
    expect((await source()).watch_error).toBe('watch_failed');
    expect(new Date((await source()).watch_next_run).getTime()).toBeLessThan(Date.now() + 45000);
    expect((await sync()).status()).toBe(200);
    expect((await status()).sources[0].pushExpiresAt).toBeTruthy();
    expect(new Date((await source()).watch_next_run).getTime()).toBeGreaterThan(Date.now());
    await remote('fault', { watchFail: false });
    await pool.query('UPDATE calendar_sources SET watch_next_run=now() WHERE id=$1', [sourceId]);
    expect((await watch()).status()).toBe(200);
    const second = (await remote('inspect')).watches[1];
    expect(second.id).not.toBe(first.id);
    expect((await remote('inspect')).stopped).toContain(first.id);
    expect((await notify(first, '3')).status()).toBe(404);
    expect((await notify(second)).status()).toBe(204);
    await pool.query(
      "UPDATE calendar_sources SET failures=1,next_run=now()+interval '10 minutes' WHERE id=$1",
      [sourceId],
    );
    const retryAt = new Date((await source()).next_run).getTime();
    expect((await notify(second, '3')).status()).toBe(204);
    expect(new Date((await source()).next_run).getTime()).toBe(retryAt);
    await pool.query('UPDATE calendar_channels SET expires_at=now() WHERE id=$1', [second.id]);
    expect((await notify(second, '4')).status()).toBe(404);
    await pool.query('UPDATE calendar_sources SET watch_next_run=now() WHERE id=$1', [sourceId]);
    expect((await watch()).status()).toBe(200);
    const third = (await remote('inspect')).watches[2];
    expect(
      (
        await page.request.post('/api/calendar/sync', {
          headers,
          data: { action: 'configure', remoteId: 'test-calendar', enabled: false },
        })
      ).status(),
    ).toBe(202);
    expect((await notify(third)).status()).toBe(404);
    expect((await harness({ action: 'configure' })).status()).toBe(200);
    expect((await watch()).status()).toBe(200);
    const fourth = (await remote('inspect')).watches[3];
    expect((await notify(fourth)).status()).toBe(204);
    expect(
      (
        await page.request.post('/api/calendar/google', { headers, data: { action: 'disconnect' } })
      ).status(),
    ).toBe(200);
    expect((await notify(fourth, '3')).status()).toBe(404);
    const reconnect = await (
      await page.request.post('/api/calendar/google', { headers, data: { action: 'connect' } })
    ).json();
    expect(
      (
        await harness({
          action: 'finish',
          state: new URL(reconnect.url).searchParams.get('state'),
          code: 'allowed',
        })
      ).status(),
    ).toBe(200);
    expect((await notify(fourth, '4')).status()).toBe(404);
    expect((await watch()).status()).toBe(200);
    const fifth = (await remote('inspect')).watches[4];
    expect((await notify(fifth)).status()).toBe(204);
  } finally {
    await pool.end();
  }
});
