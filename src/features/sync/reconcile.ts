import type { Preferences } from '@/features/settings/schema';
import {
  offlineFields,
  type FieldClock,
  type FieldClocks,
  type SettingsMutation,
  type LocalState,
  type SettingsSnapshot,
} from './schema';
export function newer(a: FieldClock, b?: FieldClock) {
  return !b || a.at > b.at || (a.at === b.at && a.clientId > b.clientId);
}
export function reconcile(
  preferences: Preferences,
  clocks: FieldClocks,
  mutation: SettingsMutation,
) {
  const next = { ...preferences };
  const nextClocks = { ...clocks };
  const conflicts: (typeof offlineFields)[number][] = [];
  let changed = false;
  const incoming = { at: mutation.at, clientId: mutation.clientId };
  for (const field of offlineFields) {
    if (mutation.patch[field] === undefined) continue;
    if (newer(incoming, clocks[field])) {
      Object.assign(next, { [field]: mutation.patch[field] });
      nextClocks[field] = incoming;
      changed = true;
    } else conflicts.push(field);
  }
  return { preferences: next, clocks: nextClocks, conflicts, changed };
}
export function optimistic(state: LocalState): SettingsSnapshot {
  return state.queue.reduce((snapshot, mutation) => {
    const merged = reconcile(snapshot.preferences, snapshot.clocks, mutation);
    return { ...snapshot, preferences: merged.preferences, clocks: merged.clocks };
  }, state.snapshot);
}
export function acceptSnapshot(
  state: LocalState,
  snapshot: SettingsSnapshot,
  acknowledged?: string,
): LocalState {
  return {
    ...state,
    snapshot: snapshot.version >= state.snapshot.version ? snapshot : state.snapshot,
    queue: state.queue.filter((m) => m.id !== acknowledged),
  };
}
export function changedPreferences(before: Preferences, after: Preferences) {
  return Object.fromEntries(
    offlineFields.filter((k) => before[k] !== after[k]).map((k) => [k, after[k]]),
  );
}
export function retryDelay(attempt: number, random = Math.random()) {
  return Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + random * 0.25);
}
