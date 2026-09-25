import { v7 as uuidv7 } from 'uuid';
import {
  bootstrapSchema,
  acknowledgementSchema,
  patchSchema,
  type SettingsSnapshot,
} from './schema';
import { acceptSnapshot, optimistic, retryDelay } from './reconcile';
import {
  getLease,
  setLease,
  clearLease,
  eraseVault,
  changeState,
  readState,
  LockedError,
} from './vault';
export type SyncStatus =
  'starting' | 'synced' | 'offline' | 'syncing' | 'queued' | 'locked' | 'error';
export const syncEvents = new EventTarget();
let channel: BroadcastChannel | undefined;
let generation = 0;
let status: SyncStatus = 'starting';
let conflicts = 0;
let flight: Promise<void> | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
function emit() {
  syncEvents.dispatchEvent(new Event('change'));
}
function broadcast(type: string) {
  if (typeof BroadcastChannel !== 'undefined') {
    channel ??= new BroadcastChannel('lifeos-sync-v1');
    channel.postMessage({ type });
  }
}
export function observeCrossTab() {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  channel ??= new BroadcastChannel('lifeos-sync-v1');
  const receive = (e: MessageEvent) => {
    if (e.data?.type === 'logout') {
      generation++;
      clearLease();
      status = 'locked';
    }
    emit();
  };
  channel.addEventListener('message', receive);
  return () => channel?.removeEventListener('message', receive);
}
export function syncInfo() {
  return { status, conflicts };
}
function setStatus(next: SyncStatus) {
  status = next;
  emit();
}
export async function purgeLocal() {
  generation++;
  clearTimeout(retryTimer);
  await eraseVault();
  conflicts = 0;
  setStatus('locked');
  broadcast('logout');
}
async function checkedFetch(input: string, init?: RequestInit) {
  const expected = generation;
  const response = await fetch(input, { cache: 'no-store', credentials: 'same-origin', ...init });
  if (expected !== generation) throw new LockedError();
  if (response.status === 401) {
    await purgeLocal();
    throw new LockedError();
  }
  if (!response.ok)
    throw new Error(
      response.status >= 500 || response.status === 429
        ? 'retryable'
        : `sync_rejected_${response.status}`,
    );
  return response;
}
export async function bootstrap() {
  const expected = generation;
  const payload = bootstrapSchema.parse(await (await checkedFetch('/api/sync')).json());
  if (expected !== generation) throw new LockedError();
  const previous = getLease();
  if (previous && previous.userId !== payload.userId) await purgeLocal();
  setLease({ userId: payload.userId, expiresAt: payload.expiresAt });
  await changeState((state) =>
    state
      ? acceptSnapshot(state, payload.snapshot)
      : { snapshot: payload.snapshot, queue: [], clientId: uuidv7(), lastClock: 0 },
  );
  emit();
  return payload;
}
export async function localSnapshot(): Promise<{ snapshot: SettingsSnapshot; pending: number }> {
  const state = await readState();
  if (!state) throw new LockedError();
  return { snapshot: optimistic(state), pending: state.queue.length };
}
export async function enqueuePreferences(patch: unknown) {
  const valid = patchSchema.parse(patch);
  await changeState((state) => {
    if (!state) throw new LockedError();
    if (state.queue.length >= 1000) throw new Error('queue_full');
    const at = Math.max(
      Date.now(),
      state.lastClock + 1,
      ...Object.values(state.snapshot.clocks).map((c) => (c?.at ?? 0) + 1),
    );
    return {
      ...state,
      lastClock: at,
      queue: [
        ...state.queue,
        { id: uuidv7(), clientId: state.clientId, at, entity: 'settings', patch: valid },
      ],
    };
  });
  setStatus('queued');
  broadcast('changed');
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) =>
        (
          reg as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }
        )?.sync?.register('lifeos-sync'),
      )
      .catch(() => {});
  }
}
async function runFlush() {
  setStatus('syncing');
  await bootstrap();
  for (let index = 0; index < 1000; index++) {
    const state = await readState();
    const mutation = state?.queue[0];
    if (!mutation) break;
    const response = await checkedFetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mutation),
    });
    const ack = acknowledgementSchema.parse(await response.json());
    if (ack.mutationId !== mutation.id) throw new Error('invalid_acknowledgement');
    await changeState((current) => {
      if (!current) throw new LockedError();
      return acceptSnapshot(current, ack.snapshot, mutation.id);
    });
    conflicts += ack.conflicts.length;
    emit();
    broadcast('changed');
  }
  await bootstrap();
  retry = 0;
  setStatus('synced');
  broadcast('changed');
}
export function flush(): Promise<void> {
  if (flight) return flight;
  clearTimeout(retryTimer);
  flight = runFlush()
    .catch((error) => {
      if (error instanceof LockedError) setStatus('locked');
      else {
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        setStatus(offline ? 'offline' : 'error');
        if (error instanceof TypeError || error?.message === 'retryable') {
          if (typeof window !== 'undefined')
            retryTimer = setTimeout(() => void flush().catch(() => {}), retryDelay(retry++));
        }
      }
      throw error;
    })
    .finally(() => {
      flight = null;
    });
  return flight;
}
export function startSync() {
  const stopObserve = observeCrossTab();
  const wake = () => {
    if (navigator.onLine) void flush().catch(() => {});
    else setStatus(getLease() ? 'offline' : 'locked');
  };
  const message = (e: MessageEvent) => {
    if (e.data?.type === 'SYNC_COMPLETE') {
      emit();
      broadcast('changed');
    }
    if (e.data?.type === 'AUTH_REVOKED') void purgeLocal();
  };
  window.addEventListener('online', wake);
  window.addEventListener('offline', wake);
  window.addEventListener('focus', wake);
  navigator.serviceWorker?.addEventListener('message', message);
  const expiry = setInterval(() => {
    if (status !== 'starting' && status !== 'syncing' && !getLease()) {
      setStatus('locked');
    }
  }, 1000);
  wake();
  return () => {
    stopObserve();
    clearInterval(expiry);
    clearTimeout(retryTimer);
    window.removeEventListener('online', wake);
    window.removeEventListener('offline', wake);
    window.removeEventListener('focus', wake);
    navigator.serviceWorker?.removeEventListener('message', message);
  };
}
