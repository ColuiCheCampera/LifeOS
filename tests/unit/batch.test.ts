import { describe, expect, it } from 'vitest';
import { applyBatch } from '@/features/work/batch';

describe('durable batch progress', () => {
  it('awaits each write and retains only failed IDs for retry', async () => {
    const events: string[] = [];
    const result = await applyBatch([{ id: 'a' }, { id: 'b' }, { id: 'c' }], async ({ id }) => {
      events.push(`start:${id}`);
      await Promise.resolve();
      if (id === 'b') throw new Error('queue_full');
      events.push(`saved:${id}`);
    });
    expect(result).toEqual({ succeeded: ['a', 'c'], failed: ['b'] });
    expect(events).toEqual(['start:a', 'saved:a', 'start:b', 'start:c', 'saved:c']);
  });
  it('handles an empty selection and total write failure', async () => {
    const fail = async () => {
      throw new Error('locked');
    };
    expect(await applyBatch([], fail)).toEqual({ succeeded: [], failed: [] });
    expect(await applyBatch([{ id: 'a' }], fail)).toEqual({ succeeded: [], failed: ['a'] });
  });
});
