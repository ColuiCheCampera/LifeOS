import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { login, resetRateLimits } from './helpers';
import { testEnv } from '../env';
test.beforeEach(resetRateLimits);

test('quick capture protects drafts and saves consecutive tasks once offline', async ({ page }) => {
  await login(page);
  const projectId = randomUUID();
  expect(
    (
      await page.request.post('/api/work', {
        headers: { Origin: testEnv.AUTH_URL },
        data: {
          id: randomUUID(),
          clientId: randomUUID(),
          at: Date.now(),
          kind: 'project',
          recordId: projectId,
          operation: 'upsert',
          patch: { title: 'Cattura QA progetto' },
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto('/tasks');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', { name: 'Nuova attività', exact: true });
  await input.fill('Cattura QA primo #captureqa p2');
  await dialog.getByLabel('Progetto', { exact: true }).selectOption(projectId);
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('Cattura QA primo #captureqa p2');
  await page.keyboard.press('Control+k');
  await expect(dialog).toHaveCount(1);
  await expect(input).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'work/quick-capture-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Salva e aggiungi un’altra', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(dialog.getByLabel('Progetto', { exact: true })).toHaveValue(projectId);
  await expect(dialog.getByRole('status')).toContainText('Attività salvata sul dispositivo');
  await input.fill('Cattura QA secondo #captureqa');
  await dialog.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press('n');
  await expect(input).toHaveValue('');
  await expect(dialog.getByLabel('Progetto', { exact: true })).toHaveValue('');
  await input.fill('Cattura QA dettaglio ogni giorno #captureqa');
  await dialog.getByRole('button', { name: 'Altre azioni', exact: true }).click();
  await expect(dialog.getByLabel('Titolo', { exact: true })).toHaveValue('Cattura QA dettaglio');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Ricorrenza RRULE', { exact: true }).fill('');
  await dialog.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press('n');
  await expect(input).toHaveValue('');
  await input.fill('Bozza da scartare');
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Attività', exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  const snapshot = await (await page.request.get('/api/work')).json();
  const tasks = snapshot.records.filter(
    (r: { kind: string; data: { tags?: string[] } }) =>
      r.kind === 'task' && r.data.tags?.includes('captureqa'),
  );
  expect(tasks).toHaveLength(3);
  for (const title of ['Cattura QA primo', 'Cattura QA secondo']) {
    expect(
      tasks.find((r: { data: { title: string } }) => r.data.title === title).data.projectId,
    ).toBe(projectId);
  }
  expect(
    tasks.find((r: { data: { title: string } }) => r.data.title === 'Cattura QA dettaglio').data
      .recurrence,
  ).toBe('');
  expect(
    snapshot.records.some((r: { data: { title: string } }) => r.data.title === 'Bozza da scartare'),
  ).toBe(false);
});
