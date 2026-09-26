import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { login } from './helpers';
import { testEnv } from '../env';
const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
test.afterAll(() => pool.end());
const headers = { Origin: testEnv.AUTH_URL };
test('task capture, all views, editing, completion, trash and keyboard commands', async ({
  page,
}) => {
  await login(page);
  await page.goto('/tasks');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.keyboard.press('n');
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Nuova attività', exact: true })
    .fill('Pagare bolletta domani alle 17 #casa p1');
  await expect(page.locator('.capture-preview')).toContainText('Pagare bolletta');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  const row = page.locator('.task-row').filter({ hasText: 'Pagare bolletta' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('P1');
  await row.locator('.task-main').click();
  await page
    .getByRole('dialog')
    .getByLabel('Note Markdown')
    .fill('**Importante**: controllare il totale');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  await page.getByRole('button', { name: 'Prossime', exact: true }).click();
  await expect(row).toHaveCount(1);
  for (const view of ['Per progetto', 'Per etichetta', 'Kanban', 'Calendario scadenze', 'Inbox']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Attività', exact: true })).toBeVisible();
  }
  await row.getByRole('button', { name: 'Completa: Pagare bolletta', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Completate', exact: true }).click();
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Altre azioni: Pagare bolletta' }).click();
  await row.getByRole('button', { name: 'Elimina', exact: true }).click();
  await page.getByRole('button', { name: 'Cestino', exact: true }).click();
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Ripristina', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByRole('textbox').fill('bolletta');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /Pagare bolletta/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'docs/screenshots/m3-tasks.png', fullPage: true });
});
test('projects, editable areas, milestones, progress and weekly review', async ({ page }) => {
  await login(page);
  await page.goto('/projects');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.getByRole('button', { name: 'Nuova area', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Titolo', { exact: true }).fill('Studio');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo progetto', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Titolo', { exact: true }).fill('Imparare italiano');
  await page
    .getByRole('dialog')
    .getByLabel('Area', { exact: true })
    .selectOption({ label: 'Studio' });
  await page.getByRole('dialog').getByLabel('Obiettivo').fill('Leggere un libro');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  const project = page.locator('.project-card').filter({ hasText: 'Imparare italiano' });
  await expect(project).toBeVisible();
  await project.getByRole('button', { name: 'Nuova tappa', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Titolo', { exact: true }).fill('Primo capitolo');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  await project.getByRole('checkbox', { name: 'Primo capitolo' }).click();
  await expect(project.getByRole('checkbox', { name: 'Primo capitolo' })).toBeChecked();
  await project.getByRole('button', { name: 'Nuova attività', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Titolo', { exact: true }).fill('Leggere dieci pagine');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  await project.locator('summary').click();
  await project.getByRole('button', { name: 'Completa: Leggere dieci pagine' }).click();
  await expect(project.getByRole('progressbar')).toHaveAttribute('value', '1');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'docs/screenshots/m3-projects.png', fullPage: true });
  await page.goto('/review');
  await expect(
    page.getByRole('heading', { name: 'Revisione settimanale', exact: true }),
  ).toBeVisible();
});
test('offline task capture survives reload and replays once after reconnect', async ({ page }) => {
  await login(page);
  await page.goto('/tasks');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Attività', exact: true })).toBeVisible();
  await page.keyboard.press('n');
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Nuova attività', exact: true })
    .fill('Comprare quaderno #studio p2');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.locator('.task-row').filter({ hasText: 'Comprare quaderno' })).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.task-row').filter({ hasText: 'Comprare quaderno' })).toHaveCount(1);
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  const data = await (await page.request.get('/api/work')).json();
  expect(
    data.records.filter((r: { data: { title: string } }) => r.data.title === 'Comprare quaderno'),
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  expect((await (await page.request.get('/api/work')).json()).revision).toBe(data.revision);
});
test('work API isolates tenants, detects cycles, merges fields and deduplicates recurring completion', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/work')).status()).toBe(401);
  expect((await request.post('/api/work', { headers, data: {} })).status()).toBe(401);
  await login(page);
  const clientId = randomUUID();
  let at = Date.now();
  const recordId = randomUUID();
  const send = (patch: unknown, rest: Record<string, unknown> = {}) =>
    page.request.post('/api/work', {
      headers,
      data: {
        id: randomUUID(),
        clientId,
        at: at++,
        kind: 'task',
        recordId,
        operation: 'upsert',
        patch,
        ...rest,
      },
    });
  expect(
    (
      await send({ title: 'Recurring', dueDate: '2026-09-25', recurrence: 'FREQ=DAILY;COUNT=2' })
    ).status(),
  ).toBe(200);
  expect((await send({ parentId: recordId })).status()).toBe(409);
  const foreignId = randomUUID(),
    foreignProject = randomUUID();
  await pool.query('INSERT INTO users(id,user_id,email) VALUES($1,$1,$2)', [
    foreignId,
    'foreign@example.test',
  ]);
  await pool.query('INSERT INTO projects(id,user_id,data) VALUES($1,$2,$3)', [
    foreignProject,
    foreignId,
    JSON.stringify({
      title: 'Private project',
      goal: '',
      notes: '',
      status: 'active',
      deadline: null,
      areaId: null,
      position: 0,
    }),
  ]);
  expect((await send({ projectId: foreignProject })).status()).toBe(409);
  expect(JSON.stringify(await (await page.request.get('/api/work')).json())).not.toContain(
    'Private project',
  );
  const first = at;
  await send({ notes: 'new note' }, { at: first + 20 });
  await send({ priority: 1 }, { at: first + 10 });
  const current = await (await page.request.get('/api/work')).json();
  expect(current.records.find((r: { id: string }) => r.id === recordId).data).toMatchObject({
    notes: 'new note',
    priority: 1,
  });
  const completed = {
    id: randomUUID(),
    clientId,
    at: first + 30,
    kind: 'task',
    recordId,
    operation: 'complete',
    patch: {},
    nextId: randomUUID(),
  };
  const ack = await (await page.request.post('/api/work', { headers, data: completed })).json();
  expect((await page.request.post('/api/work', { headers, data: completed })).status()).toBe(200);
  const replay = await (await page.request.post('/api/work', { headers, data: completed })).json();
  expect(replay).toEqual(ack);
  expect(
    ack.snapshot.records.filter((r: { id: string }) => r.id === completed.nextId),
  ).toHaveLength(1);
  expect(
    (
      await page.request.post('/api/work', {
        headers,
        data: { ...completed, patch: { title: 'changed' } },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post('/api/work', {
        headers: { Origin: 'https://evil.test' },
        data: completed,
      })
    ).status(),
  ).toBe(403);
  expect((await send({ title: 'bad', userId: foreignId })).status()).toBe(400);
  const search = await (await page.request.get('/api/work?q=Recurring')).json();
  expect(search.some((r: { id: string }) => r.id === recordId)).toBe(true);
});
test('mobile gestures and saved filters have visible accessible alternatives', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/tasks');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.keyboard.press('n');
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Nuova attività', exact: true })
    .fill('Camminare #salute p1');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  const row = page.locator('.task-row').filter({ hasText: 'Camminare' });
  await row
    .locator('.task-main')
    .dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 300 });
  await row
    .locator('.task-main')
    .dispatchEvent('pointerup', { pointerType: 'touch', clientX: 200, clientY: 300 });
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Completate', exact: true }).click();
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Riapri: Camminare' }).click();
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await page.getByRole('textbox', { name: 'Cerca o filtra attività' }).fill('p1 & #salute');
  await page.getByRole('button', { name: 'Salva filtro', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Titolo', { exact: true }).fill('Salute importante');
  await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salute importante', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const settingsTab = page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('link', { name: 'Impostazioni' });
  const box = await settingsTab.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'docs/screenshots/m3-mobile.png', fullPage: true });
});
