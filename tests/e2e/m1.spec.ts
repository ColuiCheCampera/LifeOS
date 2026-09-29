import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Pool } from 'pg';
import { testEnv } from '../env';
const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
test.afterAll(() => pool.end());
import { login, resetRateLimits } from './helpers';
test.beforeEach(resetRateLimits);
test('every private route denies unauthenticated access and security headers are present', async ({
  page,
  request,
}) => {
  for (const route of ['/', '/today', '/settings', '/tasks', '/projects', '/review']) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login/);
  }
  for (const route of ['/api/settings', '/api/sessions', '/api/health', '/api/sync', '/api/work']) {
    const response = await request.get(route);
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  expect((await request.patch('/api/settings', { data: {} })).status()).toBe(401);
  expect((await request.delete('/api/sessions', { data: {} })).status()).toBe(401);
  expect((await request.post('/api/sync', { data: {} })).status()).toBe(401);
  const response = await request.get('/login');
  expect(response.headers()['content-security-policy']).toContain("object-src 'none'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const providers = await (await request.get('/api/auth/providers')).json();
  expect(Object.keys(providers)).toEqual(['google']);
  await expect(page.getByRole('button', { name: 'Accedi con Google' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/login-desktop.png' });
});
test('rejected Google identities produce no users, accounts or sessions', async ({ page }) => {
  for (const mode of ['wrong-sub', 'wrong-email', 'unverified']) {
    const before = await pool.query(
      'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM sessions) AS sessions',
    );
    await login(page, mode);
    await expect(page).toHaveURL(/error=AccessDenied/);
    const after = await pool.query(
      'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM sessions) AS sessions',
    );
    expect(after.rows).toEqual(before.rows);
  }
});
test('allowed signed OIDC login, settings persistence, conflict and CSRF protection', async ({
  page,
}) => {
  await login(page);
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByRole('heading', { name: 'Oggi', exact: true })).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === 'authjs.session-token');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  const hashes = await pool.query('SELECT token_hash FROM sessions');
  expect(hashes.rows.some((r) => r.token_hash === cookie?.value)).toBe(false);
  await page.goto('/settings');
  await page.getByLabel('Fuso orario', { exact: true }).fill('Europe/Paris');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('status')).toHaveText('Preferenze salvate.');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.reload();
  await expect(page.getByLabel('Fuso orario', { exact: true })).toHaveValue('Europe/Paris');
  const current = await (await page.request.get('/api/settings')).json();
  expect(
    (
      await page.request.patch('/api/settings', {
        headers: { Origin: 'https://attacker.test' },
        data: current,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch('/api/settings', {
        headers: { Origin: testEnv.AUTH_URL },
        data: { ...current, version: current.version - 1 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.patch('/api/settings', {
        headers: { Origin: testEnv.AUTH_URL },
        data: { ...current, preferences: { ...current.preferences, idleMinutes: 0 } },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.patch('/api/settings', {
        headers: { Origin: testEnv.AUTH_URL, 'Content-Type': 'application/json' },
        data: 'x'.repeat(18000),
      })
    ).status(),
  ).toBe(400);
  await page.getByRole('button', { name: 'Mostra sessioni' }).click();
  await expect(page.locator('.session-list li').first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('heading', { name: 'Impostazioni', exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/settings-desktop.png' });
});
test('mobile settings, search, keyboard theme choice and localization', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/settings');
  await page.getByRole('textbox', { name: 'Cerca nelle impostazioni…' }).fill('Valuta');
  await expect(page.locator('#general')).toBeVisible();
  await expect(page.locator('#security')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Cerca nelle impostazioni…' }).fill('');
  await page.getByRole('radio', { name: 'Scuro' }).focus();
  await page.getByRole('radio', { name: 'Scuro' }).press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('status')).toHaveText('Preferenze salvate.');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('heading', { name: 'Impostazioni', exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/settings-mobile.png' });
  await page.getByRole('combobox', { name: 'Lingua', exact: true }).click();
  await page.getByRole('option', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.context().clearCookies({ name: 'lifeos-locale' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  // Restore defaults for independent subsequent tests.
  const current = await (await page.request.get('/api/settings')).json();
  await page.request.patch('/api/settings', {
    headers: { Origin: testEnv.AUTH_URL },
    data: { ...current, preferences: { ...current.preferences, locale: 'it', theme: 'system' } },
  });
});
test('idle and absolute session expiry, token rotation and revoke everywhere', async ({ page }) => {
  await login(page);
  const first = (await page.context().cookies()).find(
    (c) => c.name === 'authjs.session-token',
  )!.value;
  await login(page);
  const second = (await page.context().cookies()).find(
    (c) => c.name === 'authjs.session-token',
  )!.value;
  expect(second).not.toBe(first);
  await pool.query("UPDATE sessions SET last_seen=now()-interval '2 days'");
  expect((await page.request.get('/api/health')).status()).toBe(401);
  await login(page);
  await pool.query("UPDATE sessions SET created_at=now()-interval '91 days'");
  expect((await page.request.get('/api/health')).status()).toBe(401);
  await login(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Disconnetti tutti i dispositivi' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Conferma disconnessione' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await pool.query('SELECT count(*) FROM sessions')).rows[0].count).toBe('0');
});
test('auth CSRF and shared rate limit fail closed', async ({ request }) => {
  const response = await request.post('/api/auth/signout', {
    form: { csrfToken: 'invalid' },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toContain('MissingCSRF');
  // Prime the actual durable limiter bucket at its threshold.
  await pool.query("UPDATE rate_limits SET hits=120,window_start=date_trunc('minute',now())");
  expect((await request.get('/api/auth/providers')).status()).toBe(429);
  await pool.query('DELETE FROM rate_limits');
});
