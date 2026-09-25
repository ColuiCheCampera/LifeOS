import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { defaultPreferences } from '@/features/settings/schema';
import {
  mutationSchema,
  patchSchema,
  type LocalState,
  type SettingsMutation,
} from '@/features/sync/schema';
import {
  reconcile,
  newer,
  optimistic,
  acceptSnapshot,
  changedPreferences,
  retryDelay,
} from '@/features/sync/reconcile';
import {
  seal,
  unseal,
  keyFor,
  vault,
  setLease,
  getLease,
  clearLease,
  eraseVault,
  readState,
  changeState,
  LockedError,
} from '@/features/sync/vault';
import { isIOS, shouldOfferInstall, canApplyUpdate } from '@/features/pwa/install-policy';
const userId = randomUUID(),
  clientId = randomUUID();
const snapshot = {
  preferences: defaultPreferences,
  version: 1,
  updatedAt: new Date(0).toISOString(),
  clocks: {},
};
const state: LocalState = { snapshot, queue: [], lastClock: 0, clientId };
const mutation = (
  patch: SettingsMutation['patch'],
  at = 100,
  actor: string = clientId,
): SettingsMutation => ({ id: randomUUID(), clientId: actor, at, entity: 'settings', patch });
describe('field reconciliation', () => {
  it('patches never inject defaults for absent fields', () =>
    expect(patchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' }));
  it.each([
    {},
    { idleMinutes: 5 },
    { absoluteDays: 90 },
    { userId: 'other' },
    { timezone: 'fake' },
    { theme: 'invalid' },
  ])('rejects unsafe or invalid patches %j', (p) =>
    expect(patchSchema.safeParse(p).success).toBe(false),
  );
  it('rejects extra tenant IDs at the boundary', () =>
    expect(mutationSchema.safeParse({ ...mutation({ theme: 'dark' }), userId }).success).toBe(
      false,
    ));
  it('merges different fields independent of delivery order', () => {
    const a = mutation({ theme: 'dark' }, 200),
      b = mutation({ currency: 'USD' }, 100);
    const ab = reconcile(
      reconcile(defaultPreferences, {}, a).preferences,
      reconcile(defaultPreferences, {}, a).clocks,
      b,
    );
    const ba = reconcile(
      reconcile(defaultPreferences, {}, b).preferences,
      reconcile(defaultPreferences, {}, b).clocks,
      a,
    );
    expect(ab.preferences).toEqual(ba.preferences);
    expect(ab.preferences).toMatchObject({ theme: 'dark', currency: 'USD' });
  });
  it('keeps newer values, reports losses, and breaks equal timestamps by client ID', () => {
    const existing = reconcile(defaultPreferences, {}, mutation({ theme: 'dark' }, 200, 'b'));
    const older = reconcile(
      existing.preferences,
      existing.clocks,
      mutation({ theme: 'light' }, 100, 'z'),
    );
    expect(older.changed).toBe(false);
    expect(older.conflicts).toEqual(['theme']);
    const tied = reconcile(
      existing.preferences,
      existing.clocks,
      mutation({ theme: 'system' }, 200, 'c'),
    );
    expect(tied.preferences.theme).toBe('system');
    expect(newer({ at: 200, clientId: 'b' }, { at: 200, clientId: 'b' })).toBe(false);
    expect(newer({ at: 200, clientId: 'a' }, { at: 200, clientId: 'b' })).toBe(false);
  });
  it('replays only unacknowledged mutations and never rolls back a newer server version', () => {
    const a = mutation({ theme: 'dark' }),
      b = mutation({ currency: 'GBP' }, 101);
    const queued = { ...state, queue: [a, b] };
    expect(optimistic(queued).preferences).toMatchObject({ theme: 'dark', currency: 'GBP' });
    const newerState = { ...queued, snapshot: { ...snapshot, version: 4 } };
    const accepted = acceptSnapshot(newerState, snapshot, a.id);
    expect(accepted.snapshot.version).toBe(4);
    expect(accepted.queue).toEqual([b]);
    expect(acceptSnapshot(state, { ...snapshot, version: 2 }).snapshot.version).toBe(2);
  });
  it('diffs only eligible fields and bounds retry jitter', () => {
    expect(
      changedPreferences(defaultPreferences, {
        ...defaultPreferences,
        idleMinutes: 10,
        theme: 'dark',
      }),
    ).toEqual({ theme: 'dark' });
    expect(retryDelay(0, 0)).toBe(750);
    expect(retryDelay(100, 1)).toBe(60000);
    expect(retryDelay(1)).toBeGreaterThanOrEqual(1500);
  });
});
describe('encrypted IndexedDB vault', () => {
  beforeEach(async () => {
    await eraseVault();
    setLease({ userId, expiresAt: Date.now() + 60000 });
  });
  afterAll(() => vault.close());
  it('uses non-exportable keys, random IVs and tenant-bound authenticated encryption', async () => {
    const key = await keyFor(userId);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    expect(await keyFor(userId)).toEqual(key);
    const a = await seal({ private: 'secret' }, key, userId),
      b = await seal({ private: 'secret' }, key, userId);
    expect(a.iv).not.toEqual(b.iv);
    expect(await unseal(a, key, userId)).toEqual({ private: 'secret' });
    await expect(unseal(a, key, 'another-user')).rejects.toThrow();
    const bad = { ...a, body: a.body.slice(0) };
    new Uint8Array(bad.body)[0] ^= 1;
    await expect(unseal(bad, key, userId)).rejects.toThrow();
  });
  it('persists only ciphertext and restores a validated state', async () => {
    expect(await readState()).toBeNull();
    await changeState(() => state);
    expect(await readState()).toEqual(state);
    const stored = await vault.states.toArray();
    expect(Object.keys(stored[0]).sort()).toEqual(['revision', 'sealed', 'userId']);
    expect(JSON.stringify(stored)).not.toContain('Europe/Rome');
  });
  it('preserves concurrent edits using atomic revision checks', async () => {
    await changeState(() => state);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        changeState((current) => ({ ...current!, lastClock: current!.lastClock + 1 })),
      ),
    );
    expect((await readState())?.lastClock).toBe(8);
  });
  it('locks expired/missing grants, missing keys and purges both key and ciphertext', async () => {
    await changeState(() => state);
    expect(getLease(Date.now() + 120000)).toBeNull();
    clearLease();
    await expect(readState()).rejects.toBeInstanceOf(LockedError);
    await expect(changeState(() => state)).rejects.toBeInstanceOf(LockedError);
    setLease({ userId, expiresAt: Date.now() + 60000 });
    await vault.keys.clear();
    await expect(readState()).rejects.toBeInstanceOf(LockedError);
    await eraseVault();
    expect(await vault.states.count()).toBe(0);
    expect(await vault.keys.count()).toBe(0);
  });
  it('rejects corrupted cache payloads without returning unvalidated data', async () => {
    const key = await keyFor(userId);
    await vault.states.put({
      userId,
      revision: 1,
      sealed: await seal({ unexpected: true }, key, `lifeos:v1:${userId}`),
    });
    await expect(readState()).rejects.toThrow();
  });
});
describe('install and update policy', () => {
  it('recognizes iPhone and touch-enabled iPadOS, but not a desktop Mac', () => {
    expect(isIOS('iPhone', '', 0)).toBe(true);
    expect(isIOS('Mac', 'MacIntel', 5)).toBe(true);
    expect(isIOS('Mac', 'MacIntel', 0)).toBe(false);
  });
  it('honors installed state and dismissal, and protects queued/unsaved writes during updates', () => {
    expect(shouldOfferInstall(false, 0, 10)).toBe(true);
    expect(shouldOfferInstall(true, 0, 10)).toBe(false);
    expect(shouldOfferInstall(false, 20, 10)).toBe(false);
    expect(canApplyUpdate(0, false)).toBe(true);
    expect(canApplyUpdate(1, false)).toBe(false);
    expect(canApplyUpdate(0, true)).toBe(false);
  });
});
