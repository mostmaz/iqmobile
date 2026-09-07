// Persisted "recently viewed". Rules live in recentlyViewedCore.ts.
//
// Note the `ready` gate below. lib/compare.tsx — the file this is modelled on
// — does NOT have one: its save effect runs on the first render with the
// initial empty array, before the load has resolved, and writes `[]` over the
// stored list. It usually loses the race, which is why nobody has noticed,
// but it is exactly the bug cart.tsx:66-81 documents guarding against. Not
// inherited on purpose.

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type RecentEntry, recordView, forget, sanitize, railItems } from './recentlyViewedCore';

const KEY = 'iq_recently_viewed_v1';

let list: RecentEntry[] = [];
let ready = false;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

function persist() {
  if (!ready) return;
  AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});
}

AsyncStorage.getItem(KEY)
  .then((raw) => { if (raw) list = sanitize(JSON.parse(raw)); })
  .catch(() => { /* unreadable store — start empty rather than crash the feed */ })
  .finally(() => { ready = true; emit(); });

export function noteViewed(entry: Omit<RecentEntry, 'at'>) {
  const next = recordView(list, { ...entry, at: Date.now() });
  if (next === list) return;
  list = next;
  persist();
  emit();
}

export function forgetViewed(id: number) {
  list = forget(list, id);
  persist();
  emit();
}

/** The rail's items, excluding the device currently on screen. */
export function useRecentlyViewed(excludeId?: number | null): RecentEntry[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return railItems(list, excludeId);
}
