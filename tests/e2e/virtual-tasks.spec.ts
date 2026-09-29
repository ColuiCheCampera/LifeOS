import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { taskSchema } from '../../src/features/work/schema';
import { testEnv } from '../env';
import { login, resetRateLimits } from './helpers';

test.beforeEach(resetRateLimits);
test('long task lists reset their scroll window when filtering', async ({ page }) => {
  await login(page);
  const { userId } = await (await page.request.get('/api/sync?work=1')).json();
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  try {
    await pool.query(
      'INSERT INTO tasks (id, user_id, data) SELECT id, user_id, data FROM jsonb_to_recordset($1::jsonb) AS records(id uuid, user_id uuid, data jsonb)',
      [
        JSON.stringify(
          Array.from({ length: 130 }, (_, i) => ({
            id: randomUUID(),
            user_id: userId,
            data: taskSchema.parse({
              title: `Window QA ${String(i).padStart(3, '0')}`,
              position: i * 1024,
              tags: i < 111 ? ['windowqa', 'narrowqa'] : ['windowqa'],
            }),
          })),
        ),
      ],
    );
  } finally {
    await pool.end();
  }
  await page.goto('/tasks');
  await expect(page.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'synced');
  const search = page.getByRole('textbox', { name: 'Cerca o filtra attività' });
  await search.fill('#windowqa');
  const list = page.locator('.virtual-tasks');
  await expect(list).toBeVisible();
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(list.getByText('Window QA 129', { exact: true })).toBeVisible();
  const pitch = await list
    .locator('.task-row')
    .evaluateAll(
      (rows) => rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top,
    );
  expect(pitch).toBe(112);
  await search.fill('#narrowqa');
  await expect(list.getByText('Window QA 000', { exact: true })).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(list.locator('.task-row')).toHaveCount(22);
});
