import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { login } from './helpers';
import { testEnv } from '../env';
const headers = { Origin: testEnv.AUTH_URL };
test('manifest, worker install and public-only caches', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ id: '/', scope: '/', display: 'standalone', lang: 'it' });
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  const urls = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys())
        result.push(new URL(req.url).pathname);
    }
    return result;
  });
  expect(urls).toContain('/offline.html');
  expect(
    urls.some(
      (url) =>
        url.startsWith('/api/') || url === '/settings' || url === '/today' || url === '/login',
    ),
  ).toBe(false);
  const shell = await (await request.get('/offline.html')).text();
  expect(shell).not.toContain(testEnv.ALLOWED_EMAIL);
  expect(shell).not.toContain('Europe/Rome');
  await page.context().setOffline(true);
  await page.goto('/today');
  await expect(
    page.getByRole('heading', { name: 'Accedi online per sbloccare LifeOS' }),
  ).toBeVisible();
  await expect(page.getByLabel('Fuso orario')).toHaveCount(0);
});
test('offline edit survives reload, stays encrypted, and syncs exactly once on reconnect', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.getByLabel('Fuso orario', { exact: true }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('status')).toContainText('Salvato sul dispositivo');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Le tue preferenze, anche offline.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Fuso orario', { exact: true })).toHaveValue('Asia/Tokyo');
  const state = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('lifeos-private-v1');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rows = await new Promise<unknown[]>((resolve) => {
      const r = db.transaction('states').objectStore('states').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return JSON.stringify(rows);
  });
  expect(state).not.toContain('Asia/Tokyo');
  expect(state).not.toContain('patch');
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora' }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  expect((await (await page.request.get('/api/settings')).json()).preferences.timezone).toBe(
    'Asia/Tokyo',
  );
  const version = (await (await page.request.get('/api/settings')).json()).version;
  await page.getByRole('button', { name: 'Sincronizza ora' }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  expect((await (await page.request.get('/api/settings')).json()).version).toBe(version);
  await page.screenshot({ path: 'test-results/m2-offline.png' });
});
test('server merges fields, deduplicates replay, rejects changed replay bodies and future clocks', async ({
  page,
}) => {
  await login(page);
  const baseline = await (await page.request.get('/api/sync')).json();
  const at = Date.now() + 1000;
  const a = {
    id: randomUUID(),
    clientId: randomUUID(),
    at,
    entity: 'settings',
    patch: { currency: 'CHF' },
  };
  const b = {
    id: randomUUID(),
    clientId: randomUUID(),
    at: at - 1,
    entity: 'settings',
    patch: { timezone: 'Europe/London' },
  };
  const post = (data: unknown) => page.request.post('/api/sync', { headers, data });
  const ack = await (await post(a)).json();
  expect(ack.conflicts).toEqual([]);
  expect(ack.snapshot.version).toBe(baseline.snapshot.version + 1);
  await post(b);
  const replay = await (await post(a)).json();
  expect(replay).toEqual(ack);
  expect((await post({ ...a, patch: { currency: 'EUR' } })).status()).toBe(409);
  const stale = await (
    await post({ ...a, id: randomUUID(), at: 1, patch: { currency: 'USD' } })
  ).json();
  expect(stale.conflicts).toEqual(['currency']);
  expect((await post({ ...a, id: randomUUID(), at: Date.now() + 600000 })).status()).toBe(409);
  expect((await post({ ...a, id: randomUUID(), patch: { idleMinutes: 1440 } })).status()).toBe(400);
  expect(
    (
      await page.request.post('/api/sync', { headers: { Origin: 'https://evil.test' }, data: a })
    ).status(),
  ).toBe(403);
  const current = await (await page.request.get('/api/sync')).json();
  expect(current.snapshot.preferences).toMatchObject({
    currency: 'CHF',
    timezone: 'Europe/London',
  });
  expect(current.snapshot.version).toBe(baseline.snapshot.version + 2);
});
test('expired offline grant hides data; server logout clears cached keys across tabs', async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto('/settings');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.evaluate(() => {
    const lease = JSON.parse(sessionStorage.getItem('lifeos-offline-lease')!);
    lease.expiresAt = 1;
    sessionStorage.setItem('lifeos-offline-lease', JSON.stringify(lease));
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Accedi online per sbloccare LifeOS' }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.goto('/settings');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  const second = await context.newPage();
  await second.goto('/settings');
  await expect(second.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.getByRole('button', { name: 'Disconnetti tutti i dispositivi' }).click();
  await page.getByRole('button', { name: 'Conferma disconnessione' }).click();
  await expect(page).toHaveURL(/login/);
  await expect(
    second.getByRole('heading', { name: 'Accedi online per sbloccare LifeOS' }),
  ).toBeVisible();
  const count = await second.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('lifeos-private-v1');
      r.onsuccess = () => resolve(r.result);
    });
    const counts = await Promise.all(
      ['keys', 'states'].map(
        (store) =>
          new Promise<number>((resolve) => {
            const r = db.transaction(store).objectStore(store).count();
            r.onsuccess = () => resolve(r.result);
          }),
      ),
    );
    db.close();
    return counts;
  });
  expect(count).toEqual([0, 0]);
});
test('install prompt requires a click and honors dismissal', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    Object.assign(e, {
      prompt: async () => {
        document.body.dataset.prompted = 'yes';
      },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(e);
  });
  await expect(page.getByRole('button', { name: 'Installa', exact: true })).toBeVisible();
  expect(await page.locator('body').getAttribute('data-prompted')).toBeNull();
  await page.getByRole('button', { name: 'Installa', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-prompted', 'yes');
  await expect(page.getByRole('button', { name: 'Installa', exact: true })).toHaveCount(0);
});
test('service worker update waits for explicit approval and protects unsaved edits', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const original = await readFile('public/sw.js', 'utf8');
  try {
    await writeFile('public/sw.js', original + '\n// update test ' + randomUUID());
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });
    await expect(page.getByText('Nuova versione disponibile', { exact: true })).toBeVisible();
    await page.getByLabel('Fuso orario', { exact: true }).fill('Europe/Berlin');
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await expect(page.locator('.pwa-message')).toContainText('Salva le modifiche');
    await page.getByRole('button', { name: 'Salva modifiche' }).click();
    await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await expect(page.getByText('Nuova versione disponibile', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Fuso orario', { exact: true })).toHaveValue('Europe/Berlin');
  } finally {
    await writeFile('public/sw.js', original);
  }
});
