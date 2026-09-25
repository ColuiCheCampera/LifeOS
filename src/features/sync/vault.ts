import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { localStateSchema, type LocalState } from './schema';
export const DATABASE_NAME = 'lifeos-private-v1';
export type Sealed = { iv: Uint8Array<ArrayBuffer>; body: ArrayBuffer };
type CacheRow = { userId: string; revision: number; sealed: Sealed };
class Vault extends Dexie {
  keys!: Table<{ userId: string; key: CryptoKey }, string>;
  states!: Table<CacheRow, string>;
  constructor() {
    super(DATABASE_NAME);
    this.version(1).stores({ keys: 'userId', states: 'userId' });
  }
}
export const vault = new Vault();
const leaseSchema = z.object({ userId: z.uuid(), expiresAt: z.number().int().positive() }).strict();
export type Lease = z.infer<typeof leaseSchema>;
let workerLease: Lease | null = null;
export function setLease(lease: Lease) {
  workerLease = leaseSchema.parse(lease);
  if (typeof sessionStorage !== 'undefined')
    sessionStorage.setItem('lifeos-offline-lease', JSON.stringify(lease));
}
export function getLease(now = Date.now()): Lease | null {
  try {
    const candidate =
      typeof sessionStorage === 'undefined'
        ? workerLease
        : JSON.parse(sessionStorage.getItem('lifeos-offline-lease') ?? 'null');
    const parsed = leaseSchema.safeParse(candidate);
    return parsed.success && parsed.data.expiresAt > now ? parsed.data : null;
  } catch {
    return null;
  }
}
export function clearLease() {
  workerLease = null;
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('lifeos-offline-lease');
}
export class LockedError extends Error {
  constructor() {
    super('offline_locked');
  }
}
export async function keyFor(userId: string) {
  const existing = await vault.keys.get(userId);
  if (existing) return existing.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return vault.transaction('rw', vault.keys, async () => {
    const row = await vault.keys.get(userId);
    if (row) return row.key;
    await vault.keys.add({ userId, key });
    return key;
  });
}
export async function seal(value: unknown, key: CryptoKey, context: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    iv,
    body: await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  };
}
export async function unseal(sealed: Sealed, key: CryptoKey, context: string): Promise<unknown> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv, additionalData: new TextEncoder().encode(context) },
    key,
    sealed.body,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
export async function readState(): Promise<LocalState | null> {
  const lease = getLease();
  if (!lease) throw new LockedError();
  const row = await vault.states.get(lease.userId);
  if (!row) return null;
  const key = await vault.keys.get(lease.userId);
  if (!key) throw new LockedError();
  const state = localStateSchema.parse(
    await unseal(row.sealed, key.key, `lifeos:v1:${lease.userId}`),
  );
  if (getLease()?.userId !== lease.userId) throw new LockedError();
  return state;
}
// Encryption happens outside an IndexedDB transaction; revision CAS prevents lost concurrent writes.
export async function changeState(
  change: (state: LocalState | null) => LocalState,
): Promise<LocalState> {
  const lease = getLease();
  if (!lease) throw new LockedError();
  const key = await keyFor(lease.userId);
  for (let attempt = 0; attempt < 20; attempt++) {
    const row = await vault.states.get(lease.userId);
    const state = row
      ? localStateSchema.parse(await unseal(row.sealed, key, `lifeos:v1:${lease.userId}`))
      : null;
    const next = localStateSchema.parse(change(state));
    const sealed = await seal(next, key, `lifeos:v1:${lease.userId}`);
    if (getLease()?.userId !== lease.userId) throw new LockedError();
    const committed = await vault.transaction('rw', vault.states, vault.keys, async () => {
      if (!(await vault.keys.get(lease.userId))) throw new LockedError();
      const current = await vault.states.get(lease.userId);
      if ((current?.revision ?? 0) !== (row?.revision ?? 0)) return false;
      await vault.states.put({ userId: lease.userId, revision: (row?.revision ?? 0) + 1, sealed });
      return true;
    });
    if (committed) return next;
  }
  throw new Error('local_write_contention');
}
export async function eraseVault() {
  clearLease();
  await vault.transaction('rw', vault.states, vault.keys, async () => {
    await vault.states.clear();
    await vault.keys.clear();
  });
}
