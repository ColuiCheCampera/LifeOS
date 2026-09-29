import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { login, resetRateLimits } from './helpers';
import { testEnv } from '../env';

test.beforeEach(resetRateLimits);
test('subtasks inherit the project, exclude cycles and sync their independent progress', async ({
  page,
}) => {
  await login(page);
  const projectId = randomUUID();
  const parentId = randomUUID();
  const clientId = randomUUID();
  for (const item of [
    { kind: 'project', recordId: projectId, patch: { title: 'Sotto QA progetto' } },
    { kind: 'task', recordId: parentId, patch: { title: 'Sotto QA principale', projectId } },
  ]) {
    expect(
      (
        await page.request.post('/api/work', {
          headers: { Origin: testEnv.AUTH_URL },
          data: { ...item, id: randomUUID(), clientId, at: Date.now(), operation: 'upsert' },
        })
      ).status(),
    ).toBe(200);
  }
  await page.goto('/tasks');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.getByRole('button', { name: 'Per progetto', exact: true }).click();
  await page.getByLabel('Per progetto', { exact: true }).selectOption(projectId);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  const root = page.locator(`[data-task-id="${parentId}"]`);
  const dialog = page.getByRole('dialog');
  await root.getByRole('button', { name: 'Altre azioni: Sotto QA principale' }).click();
  await root.getByRole('button', { name: 'Aggiungi sottoattività' }).click();
  await expect(dialog.getByLabel('Progetto', { exact: true })).toHaveValue(projectId);
  await expect(dialog.getByLabel('Attività principale', { exact: true })).toHaveValue(parentId);
  await dialog.getByLabel('Titolo', { exact: true }).fill('Sotto QA figlia');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const child = page
    .locator('.task-row')
    .filter({ has: page.locator('strong', { hasText: 'Sotto QA figlia' }) });
  await expect(root).toContainText('Sottoattività dirette: 0/1 completate');
  await expect(child).toContainText('Attività principale: Sotto QA principale');
  await child.getByRole('button', { name: 'Altre azioni: Sotto QA figlia' }).click();
  await child.getByRole('button', { name: 'Aggiungi sottoattività' }).click();
  await dialog.getByLabel('Titolo', { exact: true }).fill('Sotto QA nipote');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await root.locator('.task-main').click();
  const parentOptions = dialog.getByLabel('Attività principale', { exact: true });
  for (const name of ['Sotto QA principale', 'Sotto QA figlia', 'Sotto QA nipote']) {
    await expect(parentOptions.getByRole('option', { name, exact: true })).toHaveCount(0);
  }
  await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
  await child.getByRole('button', { name: 'Completa: Sotto QA figlia' }).click();
  await expect(root).toContainText('Sottoattività dirette: 1/1 completate');
  await expect(root.getByRole('button', { name: 'Completa: Sotto QA principale' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Completa: Sotto QA nipote' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'work/subtasks-mobile.png', fullPage: true });
  await page.reload();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  const snapshot = await (await page.request.get('/api/work')).json();
  const savedChild = snapshot.records.find(
    (r: { data: { title: string } }) => r.data.title === 'Sotto QA figlia',
  );
  const savedGrandchild = snapshot.records.find(
    (r: { data: { title: string } }) => r.data.title === 'Sotto QA nipote',
  );
  expect(savedChild.data).toMatchObject({ parentId, projectId, status: 'done' });
  expect(savedGrandchild.data).toMatchObject({
    parentId: savedChild.id,
    projectId,
    status: 'todo',
  });
});
