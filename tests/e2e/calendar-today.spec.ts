import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { login, resetCalendarFixtures, resetRateLimits } from './helpers';
import { testEnv } from '../env';

test.beforeEach(resetRateLimits);
test.beforeEach(resetCalendarFixtures);
test('Today events and global search use offline data and the calendar editor', async ({
  page,
}) => {
  await login(page);
  const today = Temporal.Now.plainDateISO('Europe/Rome');
  const id = randomUUID();
  const create = async (recordId: string, patch: Record<string, unknown>) => {
    expect(
      (
        await page.request.post('/api/work', {
          headers: { Origin: testEnv.AUTH_URL },
          data: {
            id: randomUUID(),
            clientId: randomUUID(),
            kind: 'event',
            recordId,
            at: Date.now(),
            operation: 'upsert',
            patch,
          },
        })
      ).status(),
    ).toBe(200);
  };
  await create(id, {
    title: 'Agenda QA appuntamento',
    location: 'Biblioteca speciale',
    notes: 'Documentazione riservata',
    schedule: {
      start: today.toString(),
      end: today.add({ days: 1 }).toString(),
      allDay: true,
      timezone: 'Europe/Rome',
    },
  });
  await create(randomUUID(), {
    title: 'Agenda QA passato',
    schedule: {
      start: today.subtract({ days: 2 }).toString(),
      end: today.subtract({ days: 1 }).toString(),
      allDay: true,
      timezone: 'Europe/Rome',
    },
  });
  await page.reload();
  const widget = page.getByRole('region', { name: 'Prossimi eventi', exact: true });
  await expect(widget).toContainText('Agenda QA appuntamento');
  await expect(widget).not.toContainText('Agenda QA passato');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await widget.getByRole('button', { name: /Agenda QA appuntamento/ }).click();
  const editor = page.getByRole('dialog', { name: 'Evento', exact: true });
  await editor.getByRole('textbox', { name: 'Titolo', exact: true }).fill('Agenda QA offline');
  await editor.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(widget).toContainText('Agenda QA offline');
  await page.getByRole('button', { name: 'Cerca e comandi', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Cerca e comandi', exact: true });
  await palette.getByRole('textbox').fill('biblioteca speciale');
  await palette.getByRole('button', { name: 'Agenda QA offline Evento', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(
    'Documentazione riservata',
  );
  await editor.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'work/calendar-today-mobile.png', fullPage: true });
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click();
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  await page.reload();
  await expect(widget).toContainText('Agenda QA offline');
});
