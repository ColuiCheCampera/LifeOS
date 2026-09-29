import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { login, resetRateLimits } from './helpers';
import { testEnv } from '../env';
test.beforeEach(resetRateLimits);

test('filtered bulk actions persist offline and preserve unselected tasks', async ({ page }) => {
  await login(page);
  const projectId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const clientId = randomUUID();
  let at = Date.now();
  for (const item of [
    { recordId: projectId, kind: 'project', patch: { title: 'Bulk QA project' } },
    ...ids.map((recordId, i) => ({
      recordId,
      kind: 'task',
      patch: { title: `Bulk QA ${i}`, tags: i < 2 ? ['batchqa'] : ['untouchedqa'] },
    })),
  ]) {
    const response = await page.request.post('/api/work', {
      headers: { Origin: testEnv.AUTH_URL },
      data: { ...item, id: randomUUID(), clientId, at: at++, operation: 'upsert' },
    });
    expect(response.status()).toBe(200);
  }
  await page.goto('/tasks');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.getByRole('button', { name: 'Per progetto', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Cerca o filtra attività' });
  const selectAll = page.getByRole('button', { name: 'Seleziona tutte le attività filtrate' });
  const bulk = page.getByRole('group', { name: 'Azioni sulle attività selezionate' });
  await search.fill('#batchqa');
  await page.getByRole('checkbox', { name: 'Seleziona: Bulk QA 0', exact: true }).check();
  await search.fill('#untouchedqa');
  await expect(bulk).not.toBeVisible();
  await search.fill('#batchqa');
  await selectAll.click();
  await expect(bulk).toContainText('2 selezionate');
  await bulk.getByLabel('Sposta', { exact: true }).selectOption(projectId);
  await expect(bulk).not.toBeVisible();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await selectAll.click();
  await bulk.getByLabel('Sposta', { exact: true }).selectOption('inbox');
  await expect(bulk).not.toBeVisible();
  await selectAll.click();
  await bulk.getByLabel('Priorità', { exact: true }).selectOption('1');
  await expect(bulk).not.toBeVisible();
  await selectAll.click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'work/bulk-tasks-mobile.png', fullPage: true });
  await bulk.getByRole('button', { name: 'Completa', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Completate', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(2);
  await selectAll.click();
  await expect(bulk.getByRole('button', { name: 'Completa', exact: true })).toBeDisabled();
  await bulk.getByRole('button', { name: 'Riapri', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await selectAll.click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await bulk.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await bulk.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Attività', exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  const snapshot = await (await page.request.get('/api/work')).json();
  for (const [index, id] of ids.entries()) {
    const record = snapshot.records.find((r: { id: string }) => r.id === id);
    expect(record.data.projectId).toBeNull();
    expect(record.data.priority).toBe(index < 2 ? 1 : 4);
    expect(record.data.status).toBe('todo');
    expect(Boolean(record.deletedAt)).toBe(index < 2);
  }
});
