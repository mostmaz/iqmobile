// The shortlist a buyer is deciding between.
//
// Iraqi buyers open four tabs of the same phone from four sellers and try to
// hold the differences in their head. This holds them instead: pick two or
// three listings, see them side by side with the spec sheet behind each.
//
// Entries carry a thumbnail and name, not just an id, so the tray above the
// tab bar can draw the shortlist immediately. Fetching three listings just
// to render three 44pt thumbnails would leave the tray blank on every cold
// start, which is exactly when the buyer needs to see what is in it.
//
// Capped at three. A fourth column stops being a comparison and starts being
// a spreadsheet — on a phone it would either scroll horizontally (so no two
// columns are visible together, which defeats the point) or squeeze every
// column past legibility.
//
// Persisted, because the shortlist is built over hours: a buyer adds one at
// lunch and the next in the evening, and an app restart in between must not
// throw the first one away.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const COMPARE_MAX = 3;
const KEY = 'iq_compare_v2';

export interface CompareEntry {
  id: number;
  brand?: string | null;
  model?: string | null;
  image_path?: string | null;
}

interface CompareCtx {
  entries: CompareEntry[];
  ids: number[];
  has: (id: number) => boolean;
  /**
   * Add or remove, and report what happened. Callers act on the RESULT
   * (`size`) rather than on their own copy of the list: a caller that reads
   * `ids.length` right after tapping sees the value from before the state
   * update, which turned "add the second one" into "remove the first".
   */
  toggle: (entry: CompareEntry) => { ok: boolean; size: number; added: boolean };
  remove: (id: number) => void;
  clear: () => void;
  isFull: boolean;
}

const Ctx = createContext<CompareCtx>({
  entries: [], ids: [], has: () => false,
  toggle: () => ({ ok: false, size: 0, added: false }),
  remove: () => {}, clear: () => {}, isFull: false,
});

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<CompareEntry[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setEntries(
            parsed
              .filter((e) => e && Number.isInteger(e.id))
              .slice(0, COMPARE_MAX),
          );
        }
      })
      .catch(() => { /* unreadable store — start empty rather than crash */ });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(entries)).catch(() => {});
  }, [entries]);

  const toggle = useCallback((entry: CompareEntry) => {
    // Computed inside the updater so the answer reflects the list as it
    // actually is, not as the caller's last render saw it.
    let result = { ok: true, size: 0, added: false };
    setEntries((prev) => {
      if (prev.some((e) => e.id === entry.id)) {
        const next = prev.filter((e) => e.id !== entry.id);
        result = { ok: true, size: next.length, added: false };
        return next;
      }
      if (prev.length >= COMPARE_MAX) {
        result = { ok: false, size: prev.length, added: false };
        return prev;
      }
      const next = [...prev, entry];
      result = { ok: true, size: next.length, added: true };
      return next;
    });
    return result;
  }, []);

  const value = useMemo<CompareCtx>(() => ({
    entries,
    ids: entries.map((e) => e.id),
    has: (id: number) => entries.some((e) => e.id === id),
    toggle,
    remove: (id: number) => setEntries((prev) => prev.filter((e) => e.id !== id)),
    clear: () => setEntries([]),
    isFull: entries.length >= COMPARE_MAX,
  }), [entries, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCompare = () => useContext(Ctx);
